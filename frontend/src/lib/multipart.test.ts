import { describe, expect, it } from "vitest";
import type { FeatureMeasurement, FileInfo, PartMeasurement } from "./api";
import {
  CSV_COLUMNS,
  PARTS_CSV_COLUMNS,
  buildCsv,
  buildJsonExport,
  buildPartsCsv,
} from "./export";
import { M2_PER_HECTARE } from "./format";
import { partGeometryOf } from "./geo";
import { filterAndSortRows, type TableQuery } from "./table";

function part(i: number, value: number, type: "area" | "length"): PartMeasurement {
  return {
    part_index: i,
    geometry_type: type === "area" ? "Polygon" : "LineString",
    measurement_type: type,
    measurement_value: value,
    measurement_unit: type === "area" ? "m²" : "m",
    measurement_status: "COMPLETED",
    error_details: null,
  };
}

function feat(partial: Partial<FeatureMeasurement> & { feature_id: number }): FeatureMeasurement {
  return {
    geometry_type: "Polygon",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {},
    measurement: null,
    measurement_status: "COMPLETED",
    error_details: null,
    components: null,
    parts: null,
    ...partial,
  };
}

const LAKES = feat({
  feature_id: 2,
  properties: { name: "Twin Lakes" },
  geometry_type: "MultiPolygon",
  geometry: { type: "MultiPolygon", coordinates: [[[[0, 0]]], [[[1, 1]]]] },
  measurement: { type: "area", value: 21805.18, unit: "m²", status: "COMPLETED" },
  parts: [part(0, 10902.59, "area"), part(1, 10902.59, "area")],
});

const ROAD = feat({
  feature_id: 1,
  properties: { name: "Ring Road" },
  geometry_type: "MultiLineString",
  geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
  measurement: { type: "length", value: 300, unit: "m", status: "COMPLETED" },
  parts: [part(0, 100, "length"), part(1, 200, "length")],
});

const FILE: FileInfo = {
  id: "fid",
  filename: "multipart_shapes.zip",
  feature_count: 3,
  crs: "EPSG:4326",
  measurement_crs: "EPSG:32632",
  status: "COMPLETED",
  created_at: "2026-10-11T00:00:00",
  error_summary: null,
};

describe("partGeometryOf", () => {
  it("extracts the indexed member as a single geometry", () => {
    expect(partGeometryOf(LAKES.geometry, 0)).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0]]],
    });
    expect(partGeometryOf(ROAD.geometry, 1)).toEqual({
      type: "LineString",
      coordinates: [[2, 2], [3, 3]],
    });
  });
  it("returns null for single types, bad indexes, and missing geometry", () => {
    expect(partGeometryOf({ type: "Polygon", coordinates: [] }, 0)).toBeNull();
    expect(partGeometryOf({ type: "Point", coordinates: [0, 0] }, 0)).toBeNull();
    expect(partGeometryOf(LAKES.geometry, 2)).toBeNull();
    expect(partGeometryOf(LAKES.geometry, -1)).toBeNull();
    expect(partGeometryOf(null, 0)).toBeNull();
    expect(partGeometryOf({ type: "MultiPolygon" }, 0)).toBeNull();
  });
});

describe("parts sorting", () => {
  const q: TableQuery = { text: "", typeFilter: "all", statusFilter: "all", sortKey: "parts", sortDir: -1 };
  it("orders by part count with single features last", () => {
    const rows = filterAndSortRows([feat({ feature_id: 0 }), ROAD, LAKES], q);
    expect(rows.map((f) => f.feature_id)).toEqual([2, 1, 0]);
  });
});

describe("parts in exports", () => {
  it("feature-level CSV stays part-free (compatibility)", () => {
    expect(CSV_COLUMNS).not.toContain("part_index");
    const csv = buildCsv({ file: FILE, units: {}, features: [LAKES] });
    expect(csv.split("\r\n")[0]).not.toContain("part");
  });
  it("buildPartsCsv emits one row per part with labels and conversions", () => {
    const csv = buildPartsCsv({ file: FILE, units: {}, features: [feat({ feature_id: 0 }), LAKES, ROAD] });
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(PARTS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(5); // header + 2 lake parts + 2 road parts
    const lakeRows = lines.filter((l) => l.includes("Twin Lakes"));
    expect(lakeRows).toHaveLength(2);
    expect(lakeRows[0]).toContain("MultiPolygon,0,Part 1,Polygon,area,10902.59");
    expect(lakeRows[1]).toContain(",1,Part 2,Polygon,");
    // Area conversions present for polygon parts, length conversion for line parts.
    expect(lakeRows[0]).toContain(String(10902.59 / M2_PER_HECTARE));
    const roadRows = lines.filter((l) => l.includes("Ring Road"));
    expect(roadRows).toHaveLength(2);
    expect(roadRows[1]).toContain("length,200,m");
    expect(roadRows[1].split(",")[13]).toBe("0.2"); // length_km
  });
  it("buildPartsCsv handles empty inputs (header only)", () => {
    expect(buildPartsCsv({ file: FILE, units: {}, features: [] })).toBe(
      `${PARTS_CSV_COLUMNS.join(",")}\r\n`,
    );
    expect(
      buildPartsCsv({ file: FILE, units: {}, features: [feat({ feature_id: 0 })] }).split("\r\n"),
    ).toHaveLength(2);
  });
  it("buildJsonExport passes parts through, null when absent", () => {
    const doc = JSON.parse(buildJsonExport({ file: FILE, units: {}, features: [LAKES, ROAD, feat({ feature_id: 0 })] }));
    expect(doc.features[0].parts).toHaveLength(2);
    expect(doc.features[0].parts[0].part_index).toBe(0);
    expect(doc.features[0].measurement.value).toBe(21805.18); // combined untouched
    expect(doc.features[2].parts).toBeNull();
  });
});
