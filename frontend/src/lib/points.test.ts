import { describe, expect, it } from "vitest";
import type { FeatureMeasurement, FileInfo } from "./api";
import {
  POINTS_CSV_COLUMNS,
  buildCsv,
  buildJsonExport,
  buildPointsCsv,
  toCsvRow,
} from "./export";
import { formatCoordinate, isLonLatCrs } from "./format";
import { pointCountOf, pointPositionsOf } from "./geo";
import { filterAndSortRows, type TableQuery } from "./table";

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

const PEGS = feat({
  feature_id: 2,
  properties: { name: "Survey Pegs" },
  geometry_type: "MultiPoint",
  geometry: {
    type: "MultiPoint",
    coordinates: [
      [9.0, 48.0],
      [9.001, 48.0],
      [9.0, 48.001],
    ],
  },
  measurement: null,
  measurement_status: "NOT_APPLICABLE",
});

const PEG = feat({
  feature_id: 3,
  geometry_type: "Point",
  geometry: { type: "Point", coordinates: [9.5, 48.5] },
  measurement: null,
  measurement_status: "NOT_APPLICABLE",
});

const FILE: FileInfo = {
  id: "fid",
  filename: "multipart_shapes.zip",
  feature_count: 3,
  crs: "EPSG:4326",
  measurement_crs: "EPSG:32632",
  status: "COMPLETED_WITH_ERRORS",
  created_at: "2026-10-11T00:00:00",
  error_summary: null,
};

describe("pointPositionsOf / pointCountOf", () => {
  it("counts actual positions: Point -> 1, MultiPoint -> N", () => {
    expect(pointCountOf(PEG.geometry)).toBe(1);
    expect(pointCountOf(PEGS.geometry)).toBe(3);
    expect(pointPositionsOf(PEGS.geometry)).toHaveLength(3);
  });
  it("returns null for area/length/collection types (not applicable)", () => {
    expect(pointCountOf({ type: "Polygon", coordinates: [] })).toBeNull();
    expect(
      pointCountOf({ type: "LineString", coordinates: [[0, 0], [1, 1]] }),
    ).toBeNull();
    expect(
      pointCountOf({ type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [0, 0] }] }),
    ).toBeNull();
  });
  it("returns null for missing, empty, or malformed point geometries", () => {
    expect(pointCountOf(null)).toBeNull();
    expect(pointCountOf({ type: "MultiPoint", coordinates: [] })).toBeNull();
    expect(pointCountOf({ type: "Point", coordinates: [] })).toBeNull();
    expect(pointCountOf({ type: "Point", coordinates: ["a", "b"] })).toBeNull();
    expect(pointCountOf({ type: "MultiPoint" })).toBeNull();
    // Malformed members are skipped, not counted; none usable -> null.
    expect(
      pointCountOf({ type: "MultiPoint", coordinates: [[9, 48], ["x", 1], null] }),
    ).toBe(1);
  });
  it("accepts 3D positions (first two axes)", () => {
    expect(pointCountOf({ type: "Point", coordinates: [9, 48, 100] })).toBe(1);
  });
});

describe("coordinate presentation helpers", () => {
  it("detects lon/lat CRS without mislabelling projected ones", () => {
    expect(isLonLatCrs("EPSG:4326")).toBe(true);
    expect(isLonLatCrs("epsg:4326")).toBe(true);
    expect(isLonLatCrs("WGS84")).toBe(true);
    expect(isLonLatCrs("EPSG:32632")).toBe(false);
    expect(isLonLatCrs(null)).toBe(false);
    expect(isLonLatCrs("")).toBe(false);
  });
  it("formats coordinates readably, never as missing when finite", () => {
    expect(formatCoordinate(9.001)).toBe("9.001");
    expect(formatCoordinate(48.123456789)).toBe("48.123457");
    expect(formatCoordinate(Number.NaN)).toBe("—");
  });
});

describe("point sorting", () => {
  const q: TableQuery = { text: "", typeFilter: "all", statusFilter: "all", sortKey: "points", sortDir: -1 };
  it("sorts by point count with non-points last", () => {
    const rows = filterAndSortRows([PEGS, PEG, feat({ feature_id: 0 })], q);
    expect(rows.map((f) => f.feature_id)).toEqual([2, 3, 0]);
  });
});

describe("point count in exports", () => {
  it("toCsvRow emits point_count only for point geometries", () => {
    const mp = toCsvRow(FILE.id, FILE.filename, "EPSG:4326", "EPSG:32632", PEGS, "");
    expect(mp.point_count).toBe("3");
    const poly = toCsvRow(FILE.id, FILE.filename, "EPSG:4326", "EPSG:32632", feat({ feature_id: 0 }), "Land 1");
    expect(poly.point_count).toBe("");
  });
  it("buildCsv appends point_count without disturbing earlier columns", () => {
    const csv = buildCsv({ file: FILE, units: {}, features: [PEGS] });
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0].endsWith(",point_count")).toBe(true);
    expect(lines[1].endsWith(",3")).toBe(true);
  });
  it("buildJsonExport adds point_count, keeping geometry for coordinates", () => {
    const doc = JSON.parse(buildJsonExport({ file: FILE, units: {}, features: [PEGS, PEG] }));
    expect(doc.features[0].point_count).toBe(3);
    expect(doc.features[1].point_count).toBe(1);
    expect(doc.features[0].geometry.type).toBe("MultiPoint");
  });
});

describe("buildPointsCsv", () => {
  it("emits one row per stored point with index and CRS", () => {
    const csv = buildPointsCsv({ file: FILE, units: {}, features: [feat({ feature_id: 0 }), PEGS, PEG] });
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(POINTS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(5); // header + 3 pegs + 1 peg
    expect(lines[1]).toContain("Survey Pegs,MultiPoint,0,9,48,EPSG:4326");
    expect(lines[3]).toContain(",2,9,48.001,");
    expect(lines[4].split(",")[5]).toBe("0"); // single Point has index 0
  });
  it("uses full-precision values and skips features without positions", () => {
    const csv = buildPointsCsv({
      file: FILE,
      units: {},
      features: [feat({ feature_id: 0 }), PEGS],
    });
    expect(csv).toContain("9.001");
    expect(csv.split("\r\n").filter((l) => l.length > 0)).toHaveLength(4);
  });
  it("handles empty feature lists (header only)", () => {
    expect(buildPointsCsv({ file: FILE, units: {}, features: [] })).toBe(
      `${POINTS_CSV_COLUMNS.join(",")}\r\n`,
    );
  });
});
