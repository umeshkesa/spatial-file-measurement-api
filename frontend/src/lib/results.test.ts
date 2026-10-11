import { describe, expect, it } from "vitest";
import type { FeatureMeasurement } from "./api";
import {
  M2_PER_ACRE,
  M2_PER_HECTARE,
  M_PER_KM,
  areaOf,
  assignLandLabels,
  formatMetric,
  lengthOf,
  summarize,
} from "./format";
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

const ROWS = [
  feat({ feature_id: 0, properties: { Name: "Simple Park" }, measurement: { type: "area", value: 43608.0278, unit: "m²", status: "COMPLETED" } }),
  feat({ feature_id: 1, properties: { Name: "Building With Courtyard" }, measurement: { type: "area", value: 32703.3559, unit: "m²", status: "COMPLETED" } }),
  feat({ feature_id: 2, properties: { Name: "Main Road" }, geometry_type: "LineString", geometry: { type: "LineString", coordinates: [] }, measurement: { type: "length", value: 315.2319, unit: "m", status: "COMPLETED" } }),
  feat({ feature_id: 3, properties: { Name: "Entrance Gate" }, geometry_type: "Point", geometry: { type: "Point", coordinates: [] }, measurement: null, measurement_status: "NOT_APPLICABLE" }),
  feat({ feature_id: 4, properties: { Name: "Two Fields" }, geometry_type: "MultiPolygon", geometry: { type: "MultiPolygon", coordinates: [] }, measurement: { type: "area", value: 21804.5424, unit: "m²", status: "COMPLETED" } }),
  feat({ feature_id: 5, properties: { Name: "Mixed Bag" }, geometry_type: "GeometryCollection", geometry: { type: "GeometryCollection", geometries: [] }, measurement: null, measurement_status: "PARTIAL", components: [] }),
  feat({ feature_id: 6, properties: { Name: "Broken Outline" }, measurement: null, measurement_status: "FAILED", error_details: "Empty geometry." }),
];

const BASE_Q: TableQuery = { text: "", typeFilter: "all", statusFilter: "all", sortKey: "feature_id", sortDir: 1 };

describe("unit conversions", () => {
  it("uses exact conversion factors", () => {
    expect(M2_PER_HECTARE).toBe(10_000);
    expect(M2_PER_ACRE).toBe(4046.8564224);
    expect(M_PER_KM).toBe(1000);
  });
  it("converts the courtyard area consistently", () => {
    const m2 = 32703.355958785643;
    expect(m2 / M2_PER_HECTARE).toBeCloseTo(3.2703355, 6);
    expect(m2 / M2_PER_ACRE).toBeCloseTo(8.0812, 4);
  });
  it("never renders missing values as zero, but keeps genuine zeros", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatMetric(undefined)).toBe("—");
    expect(formatMetric(Number.NaN)).toBe("—");
    expect(formatMetric(0)).toBe("0");
    expect(formatMetric(10902.051389)).toBe("10,902.05");
  });
  it("areaOf/lengthOf only read matching measurement types", () => {
    expect(areaOf(ROWS[0])).toBeCloseTo(43608.0278, 4);
    expect(lengthOf(ROWS[0])).toBeNull();
    expect(lengthOf(ROWS[2])).toBeCloseTo(315.2319, 4);
    expect(areaOf(ROWS[2])).toBeNull();
    expect(areaOf(ROWS[3])).toBeNull();
    expect(areaOf(ROWS[5])).toBeNull(); // PARTIAL has no single value
  });
});

describe("assignLandLabels", () => {
  it("numbers polygon features Land 1..N by feature ID, ignoring others", () => {
    const labels = assignLandLabels(ROWS);
    expect(labels.get(0)).toBe("Land 1");
    expect(labels.get(1)).toBe("Land 2");
    expect(labels.get(4)).toBe("Land 3");
    expect(labels.get(6)).toBe("Land 4"); // failed polygon still listed
    expect(labels.has(2)).toBe(false);
    expect(labels.has(3)).toBe(false);
    expect(labels.has(5)).toBe(false);
    expect(labels.size).toBe(4);
  });
  it("handles empty lists", () => {
    expect(assignLandLabels([]).size).toBe(0);
  });
});

describe("filterAndSortRows", () => {
  it("searches by name (case-insensitive) and by ID", () => {
    expect(filterAndSortRows(ROWS, { ...BASE_Q, text: "courtyard" }).map((f) => f.feature_id)).toEqual([1]);
    expect(filterAndSortRows(ROWS, { ...BASE_Q, text: "ROAD" }).map((f) => f.feature_id)).toEqual([2]);
    expect(filterAndSortRows(ROWS, { ...BASE_Q, text: "4" }).map((f) => f.feature_id)).toEqual([4]);
    expect(filterAndSortRows(ROWS, { ...BASE_Q, text: "nope" })).toEqual([]);
  });
  it("sorts by name, area, length, status with nulls last", () => {
    expect(filterAndSortRows(ROWS, { ...BASE_Q, sortKey: "name" })[0].feature_id).toBe(6); // "Broken Outline"
    const byArea = filterAndSortRows(ROWS, { ...BASE_Q, sortKey: "area", sortDir: -1 }).map((f) => f.feature_id);
    expect(byArea.slice(0, 3)).toEqual([0, 1, 4]);
    const byLength = filterAndSortRows(ROWS, { ...BASE_Q, sortKey: "length" }).map((f) => f.feature_id);
    expect(byLength[0]).toBe(2);
    expect(filterAndSortRows(ROWS, { ...BASE_Q, sortKey: "status" }).map((f) => f.measurement_status)[0]).toBe("COMPLETED");
  });
  it("combines search with geometry and status filters", () => {
    const q: TableQuery = { ...BASE_Q, text: "a", typeFilter: "Polygon", statusFilter: "COMPLETED" };
    expect(filterAndSortRows(ROWS, q).map((f) => f.feature_id)).toEqual([0, 1]);
  });
});

describe("dashboard totals equal the sum of eligible individuals", () => {
  // Real geometry_catalog.kml API values.
  const CATALOG = [
    feat({ feature_id: 0, measurement: { type: "area", value: 43608.02787783375, unit: "m²", status: "COMPLETED" } }),
    feat({ feature_id: 1, measurement: { type: "area", value: 32703.355958785643, unit: "m²", status: "COMPLETED" } }),
    feat({ feature_id: 2, geometry_type: "LineString", measurement: { type: "length", value: 315.2319563176119, unit: "m", status: "COMPLETED" } }),
    feat({ feature_id: 3, geometry_type: "Point", measurement: null, measurement_status: "NOT_APPLICABLE" }),
    feat({ feature_id: 4, geometry_type: "MultiPolygon", measurement: { type: "area", value: 21804.54248748732, unit: "m²", status: "COMPLETED" } }),
    feat({ feature_id: 5, geometry_type: "GeometryCollection", measurement: null, measurement_status: "PARTIAL", components: [] }),
    feat({ feature_id: 6, measurement: null, measurement_status: "FAILED", error_details: "Empty geometry." }),
  ];

  it("sums only eligible top-level measurements", () => {
    const s = summarize(CATALOG);
    const expectedArea = 43608.02787783375 + 32703.355958785643 + 21804.54248748732;
    expect(s.totalArea).toBeCloseTo(expectedArea, 6);
    expect(s.totalLength).toBeCloseTo(315.2319563176119, 6);
    expect(s.failedCount).toBe(1);
    expect(s.unsupportedCount).toBe(0);
    expect(s.partialCount).toBe(1);
    expect(s.polygonCount).toBe(4);
    // Empty/failed and partial features contribute nothing to the totals.
    expect(areaOf(CATALOG[5])).toBeNull();
    expect(areaOf(CATALOG[6])).toBeNull();
    expect(lengthOf(CATALOG[5])).toBeNull();
  });
});
