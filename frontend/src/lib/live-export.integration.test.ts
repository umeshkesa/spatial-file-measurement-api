import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFileInfo } from "./api";
import { buildCsv, buildJsonExport, fetchAllMeasurements } from "./export";

// Live end-to-end test: requires the FastAPI backend running and
// SPATIAL_LIVE_API=1. Uploads the real sample files through the same
// endpoints the UI uses, then exports through the real pagination walk.
const LIVE = process.env.SPATIAL_LIVE_API === "1";
const SAMPLES = join(__dirname, "..", "..", "..", "sample_data");

async function uploadSample(filename: string, kind: string): Promise<string> {
  const bytes = readFileSync(join(SAMPLES, filename));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: kind }), filename);
  const base =
    (process.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8000";
  const res = await fetch(`${base}/api/files/`, { method: "POST", body: form });
  if (res.status !== 201) throw new Error(`upload ${filename} -> ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe.skipIf(!LIVE)("live export workflow", () => {
  it("survey.kml: upload -> all pages -> CSV + JSON", async () => {
    const id = await uploadSample("survey.kml", "application/vnd.google-earth.kml+xml");
    const info = await getFileInfo(id);
    expect(info.feature_count).toBe(3);
    const bundle = await fetchAllMeasurements(id, info);
    expect(bundle.features).toHaveLength(3);
    expect(bundle.features.map((f) => f.feature_id)).toEqual([0, 1, 2]);

    const csv = buildCsv(bundle);
    expect(csv).toContain("feature_id,feature_name");
    const point = bundle.features.find((f) => f.geometry_type === "Point");
    expect(point?.measurement_status).toBe("NOT_APPLICABLE");
    const pointLine = csv.split("\r\n").find((l) => l.startsWith(`${id},survey.kml,${point?.feature_id},`));
    expect(pointLine).toBeDefined();
    // Empty measurement value column for NOT_APPLICABLE (never zero).
    const cols = pointLine!.split(",");
    expect(cols[8]).toBe("");

    const doc = JSON.parse(buildJsonExport(bundle)) as { measurement_crs: string; features: unknown[] };
    expect(doc.measurement_crs).toBe("EPSG:32643");
    expect(doc.features).toHaveLength(3);
  }, 60000);

  it("parcels.zip: upload -> all pages -> CSV", async () => {
    const id = await uploadSample("parcels.zip", "application/zip");
    const info = await getFileInfo(id);
    expect(info.feature_count).toBeGreaterThan(0);
    const bundle = await fetchAllMeasurements(id, info);
    expect(bundle.features).toHaveLength(info.feature_count);
    const csv = buildCsv(bundle);
    expect(csv.split("\r\n").filter((l) => l.length > 0)).toHaveLength(info.feature_count + 1);
  }, 60000);
});
