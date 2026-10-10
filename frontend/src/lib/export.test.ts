import { describe, expect, it, vi } from "vitest";
import type { FeatureMeasurement, FileInfo, MeasurementsPage } from "./api";
import {
  CSV_COLUMNS,
  buildCsv,
  buildJsonExport,
  escapeCsvCell,
  exportFilename,
  fetchAllMeasurements,
  sanitizeFormulaCell,
  toCsvRow,
} from "./export";

const FILE: FileInfo = {
  id: "abc123",
  filename: "survey.kml",
  feature_count: 3,
  crs: "EPSG:4326",
  measurement_crs: "EPSG:32643",
  status: "COMPLETED",
  created_at: "2026-10-10T10:00:00",
  error_summary: null,
};

function feat(partial: Partial<FeatureMeasurement> & { feature_id: number }): FeatureMeasurement {
  return {
    geometry_type: "Polygon",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {},
    measurement: null,
    measurement_status: "COMPLETED",
    error_details: null,
    ...partial,
  };
}

describe("escapeCsvCell", () => {
  it("leaves plain text untouched", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell("EPSG:4326")).toBe("EPSG:4326");
  });
  it("maps null/undefined to empty", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
  it("serializes numbers with full precision", () => {
    expect(escapeCsvCell(10902.05138908191)).toBe("10902.05138908191");
    expect(escapeCsvCell(0)).toBe("0");
  });
  it("quotes cells with commas, quotes, or newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("a\rb")).toBe('"a\rb"');
  });
});

describe("sanitizeFormulaCell", () => {
  it.each([["=1+1"], ["+cmd"], ["-2+3"], ["@SUM(A1)"], ["=HYPERLINK("]])(
    "prefixes dangerous %s with a single quote",
    (v) => {
      expect(sanitizeFormulaCell(v)).toBe(`'${v}`);
    },
  );
  it("leaves safe text untouched", () => {
    expect(sanitizeFormulaCell("Plot 12")).toBe("Plot 12");
    expect(sanitizeFormulaCell("m²")).toBe("m²");
    expect(sanitizeFormulaCell("")).toBe("");
  });
  it("is applied inside CSV escaping", () => {
    expect(escapeCsvCell("=1,2")).toBe("\"'=1,2\"");
  });
});

describe("toCsvRow", () => {
  it("keeps NOT_APPLICABLE values empty (never zero)", () => {
    const row = toCsvRow(FILE.id, FILE.filename, "EPSG:4326", "EPSG:32643", feat({
      feature_id: 2,
      geometry_type: "Point",
      measurement: null,
      measurement_status: "NOT_APPLICABLE",
    }));
    expect(row.measurement_value).toBe("");
    expect(row.measurement_type).toBe("");
    expect(row.measurement_status).toBe("NOT_APPLICABLE");
  });
  it("preserves a genuine zero measurement", () => {
    const row = toCsvRow(FILE.id, FILE.filename, "EPSG:4326", "EPSG:32643", feat({
      feature_id: 0,
      measurement: { type: "area", value: 0, unit: "m²", status: "COMPLETED" },
    }));
    expect(row.measurement_value).toBe("0");
  });
  it("preserves full float precision", () => {
    const row = toCsvRow(FILE.id, FILE.filename, "EPSG:4326", "EPSG:32643", feat({
      feature_id: 0,
      measurement: { type: "area", value: 10902.05138908191, unit: "m²", status: "COMPLETED" },
    }));
    expect(row.measurement_value).toBe("10902.05138908191");
  });
});

describe("buildCsv", () => {
  it("emits the required header plus one row per feature", () => {
    const csv = buildCsv({
      file: FILE,
      units: { area: "m²", length: "m" },
      features: [
        feat({ feature_id: 0, properties: { Name: "Plot, A" }, measurement: { type: "area", value: 10.5, unit: "m²", status: "COMPLETED" } }),
        feat({ feature_id: 1, geometry_type: "Point", measurement: null, measurement_status: "NOT_APPLICABLE" }),
      ],
    });
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1]).toContain('"Plot, A"');
    expect(lines[1]).toContain("10.5");
    // Point row: empty value column, NOT_APPLICABLE status.
    const cols = lines[2].split(",");
    expect(cols[CSV_COLUMNS.indexOf("measurement_value")]).toBe("");
    expect(cols[CSV_COLUMNS.indexOf("measurement_status")]).toBe("NOT_APPLICABLE");
  });
  it("handles empty feature lists (header only)", () => {
    expect(buildCsv({ file: FILE, units: {}, features: [] })).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });
});

describe("buildJsonExport", () => {
  it("produces valid JSON with metadata and all records", () => {
    const text = buildJsonExport({
      file: FILE,
      units: { area: "m²", length: "m" },
      features: [feat({ feature_id: 0 })],
    });
    const doc = JSON.parse(text) as Record<string, unknown>;
    expect(doc.file_id).toBe("abc123");
    expect(doc.source_crs).toBe("EPSG:4326");
    expect(doc.measurement_crs).toBe("EPSG:32643");
    expect(doc.feature_count).toBe(3);
    expect(doc.units).toEqual({ area: "m²", length: "m" });
    expect(doc.features).toHaveLength(1);
  });
  it("is readable (indented) and handles empty data", () => {
    const text = buildJsonExport({ file: FILE, units: {}, features: [] });
    expect(text).toContain("\n");
    expect((JSON.parse(text) as { features: unknown[] }).features).toEqual([]);
  });
});

describe("exportFilename", () => {
  it("builds a dated filename from the original name", () => {
    const name = exportFilename("survey.kml", "csv", new Date("2026-10-10T00:00:00Z"));
    expect(name).toBe("survey_measurements_2026-10-10.csv");
  });
  it("sanitizes unsafe stems", () => {
    const name = exportFilename("my survey (final).zip", "json", new Date("2026-01-02T00:00:00Z"));
    expect(name).toBe("my_survey_final_measurements_2026-01-02.json");
  });
});

function stubPage(total: number, offset: number, ids: number[], hasMore: boolean): MeasurementsPage {
  return {
    file_id: FILE.id,
    source_crs: "EPSG:4326",
    measurement_crs: "EPSG:32643",
    units: { area: "m²", length: "m" },
    total,
    limit: 500,
    offset,
    count: ids.length,
    has_more: hasMore,
    features: ids.map((i) => feat({ feature_id: i })),
  };
}

describe("fetchAllMeasurements", () => {
  it("walks multiple pages without duplicates or gaps", async () => {
    const fetchPage = vi.fn(async (_id: string, _limit: number, offset: number) => {
      if (offset === 0) return stubPage(3, 0, [0, 1], true);
      return stubPage(3, 2, [2], false);
    });
    const bundle = await fetchAllMeasurements(FILE.id, FILE, undefined, fetchPage);
    expect(bundle.features.map((f) => f.feature_id)).toEqual([0, 1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("throws on non-contiguous offsets instead of exporting partial data", async () => {
    const fetchPage = vi.fn(async () => stubPage(3, 99, [2], false));
    await expect(fetchAllMeasurements(FILE.id, FILE, undefined, fetchPage)).rejects.toThrow(
      /contiguous/,
    );
  });
  it("throws when a page fails instead of exporting partial data", async () => {
    const fetchPage = vi.fn(async (_id: string, _l: number, offset: number) => {
      if (offset === 0) return stubPage(2, 0, [0], true);
      throw new Error("boom");
    });
    await expect(fetchAllMeasurements(FILE.id, FILE, undefined, fetchPage)).rejects.toThrow("boom");
  });
  it("reports progress while fetching", async () => {
    const seen: Array<[number, number | null]> = [];
    const fetchPage = vi.fn(async () => stubPage(1, 0, [0], false));
    await fetchAllMeasurements(FILE.id, FILE, (l, t) => seen.push([l, t]), fetchPage);
    expect(seen).toEqual([[1, 1]]);
  });
});
