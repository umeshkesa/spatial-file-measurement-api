import { describe, expect, it } from "vitest";
import {
  pointInRing,
  representativePointOfMultiPolygon,
  representativePointOfPolygon,
  ringArea,
  selectionViewForGeometry,
  type LngLat,
} from "./geo";

const SQUARE = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
];

// C-shape (concave): centroid (2,2) lies OUTSIDE the polygon.
const C_SHAPE = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 3],
  [3, 3],
  [3, 1],
  [0, 1],
  [0, 0],
];

const HOLE = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
  [1, 1],
];

function inside(pt: LngLat | null): pt is LngLat {
  expect(pt).not.toBeNull();
  return true;
}

describe("ringArea", () => {
  it("orders rings by size", () => {
    expect(Math.abs(ringArea(SQUARE))).toBeCloseTo(16, 9);
    expect(Math.abs(ringArea(HOLE))).toBeCloseTo(1, 9);
  });
});

describe("pointInRing", () => {
  it("detects inside/outside", () => {
    expect(pointInRing([2, 2], SQUARE)).toBe(true);
    expect(pointInRing([9, 9], SQUARE)).toBe(false);
    // Centroid of the C-shape is in the notch, outside the polygon.
    expect(pointInRing([2, 2], C_SHAPE)).toBe(false);
  });
});

describe("representativePointOfPolygon", () => {
  it("lands inside a concave polygon (centroid would fail)", () => {
    const pt = representativePointOfPolygon([C_SHAPE]);
    if (inside(pt)) {
      expect(pointInRing(pt, C_SHAPE)).toBe(true);
      expect(pt).not.toEqual([2, 2]);
    }
  });
  it("avoids holes", () => {
    const pt = representativePointOfPolygon([SQUARE, HOLE]);
    if (inside(pt)) {
      expect(pointInRing(pt, SQUARE)).toBe(true);
      expect(pointInRing(pt, HOLE)).toBe(false);
    }
  });
  it("returns null for degenerate input", () => {
    expect(representativePointOfPolygon([])).toBeNull();
    expect(representativePointOfPolygon(null)).toBeNull();
    expect(representativePointOfPolygon([[[0, 0], [0, 0]]])).toBeNull();
    expect(representativePointOfPolygon([[["a", "b"]]])).toBeNull();
  });
  it("handles 3D coordinates", () => {
    const ring3d = SQUARE.map(([x, y]) => [x, y, 10]);
    const pt = representativePointOfPolygon([ring3d]);
    expect(pt).not.toBeNull();
    if (pt) expect(pointInRing(pt, SQUARE)).toBe(true);
  });
});

describe("real sample data (parcels.zip regression)", () => {
  // Exact polygons served by the API for sample_data/parcels.zip.
  const PARCEL_A = [
    [77.0, 28.0],
    [77.0, 28.001],
    [77.001, 28.001],
    [77.001, 28.0],
    [77.0, 28.0],
  ];
  const PARCEL_B = [
    [77.01, 28.01],
    [77.01, 28.011],
    [77.011, 28.011],
    [77.011, 28.01],
    [77.01, 28.01],
  ];

  it("places an interior marker inside each parcels.zip polygon", () => {
    const a = representativePointOfPolygon([PARCEL_A]);
    const b = representativePointOfPolygon([PARCEL_B]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a && b) {
      expect(pointInRing(a, PARCEL_A)).toBe(true);
      expect(pointInRing(b, PARCEL_B)).toBe(true);
      // Distinct markers ~1.5 km apart: both discoverable when zoomed out.
      expect(Math.abs(a[0] - b[0])).toBeGreaterThan(0.005);
    }
  });
});

describe("selectionViewForGeometry", () => {
  it("frames polygons and lines by bounds", () => {
    const poly = selectionViewForGeometry({ type: "Polygon", coordinates: [SQUARE] });
    expect(poly).toEqual({ kind: "bounds", southWest: [0, 0], northEast: [4, 4] });
    const line = selectionViewForGeometry({
      type: "LineString",
      coordinates: [[1, 2], [5, 9]],
    });
    expect(line).toEqual({ kind: "bounds", southWest: [1, 2], northEast: [5, 9] });
  });
  it("centers on points and degenerate geometries", () => {
    expect(selectionViewForGeometry({ type: "Point", coordinates: [7, 8] })).toEqual({
      kind: "point",
      at: [7, 8],
    });
    expect(
      selectionViewForGeometry({ type: "MultiPoint", coordinates: [[3, 3], [3, 3]] }),
    ).toEqual({ kind: "point", at: [3, 3] });
  });
  it("unions GeometryCollection members", () => {
    const view = selectionViewForGeometry({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [0, 0] },
        { type: "LineString", coordinates: [[10, 20], [30, 40]] },
      ],
    });
    expect(view).toEqual({ kind: "bounds", southWest: [0, 0], northEast: [30, 40] });
  });
  it("returns null for empty or invalid geometries", () => {
    expect(selectionViewForGeometry(null)).toBeNull();
    expect(selectionViewForGeometry({})).toBeNull();
    expect(selectionViewForGeometry({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("representativePointOfMultiPolygon", () => {
  it("uses the largest component (one marker per feature)", () => {
    const big = SQUARE;
    const small = [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
      [10, 10],
    ];
    const pt = representativePointOfMultiPolygon([[small], [big]]);
    expect(pt).not.toBeNull();
    if (pt) {
      expect(pointInRing(pt, big)).toBe(true);
      expect(pointInRing(pt, small)).toBe(false);
    }
  });
  it("returns null for empty input", () => {
    expect(representativePointOfMultiPolygon([])).toBeNull();
    expect(representativePointOfMultiPolygon(null)).toBeNull();
  });
});
