/** Pure GeoJSON-geometry helpers (lon/lat order). No Leaflet dependency. */

export type LngLat = [number, number];

export function isFinitePair(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

/** Recursively collect [lng, lat] positions; understands GeometryCollections. */
export function collectGeometryPositions(g: unknown, out: LngLat[]): void {
  if (!g || typeof g !== "object") return;
  const geom = g as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
    for (const part of geom.geometries) collectGeometryPositions(part, out);
    return;
  }
  collectPositions(geom.coordinates, out);
}

export function collectPositions(coords: unknown, out: LngLat[]): void {
  if (isFinitePair(coords)) {
    out.push([coords[0], coords[1]]);
  } else if (Array.isArray(coords)) {
    for (const c of coords) collectPositions(c, out);
  }
}

function ringPositions(ring: unknown): LngLat[] {
  if (!Array.isArray(ring)) return [];
  return ring.filter(isFinitePair);
}

/** Signed shoelace area (square degrees — ordering only, never a measurement). */
export function ringArea(ring: unknown): number {
  const pts = ringPositions(ring);
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    sum += (pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]) / 2;
  }
  return sum;
}

/** Ray-casting point-in-ring test. */
export function pointInRing(pt: LngLat, ring: unknown): boolean {
  const pts = ringPositions(ring);
  if (pts.length < 4) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegmentSquared(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx - p[0];
  const cy = a[1] + t * dy - p[1];
  return cx * cx + cy * cy;
}

function minDistToRingSquared(pt: LngLat, ring: unknown): number {
  const pts = ringPositions(ring);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distToSegmentSquared(pt, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function pointInsidePolygon(pt: LngLat, rings: unknown): boolean {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  if (!pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(pt, rings[i])) return false; // inside a hole
  }
  return true;
}

/**
 * Representative point guaranteed inside the polygon (pole-of-inaccessibility
 * sampling): bbox-center first, else the interior grid cell farthest from any
 * edge. Returns null for degenerate input. Never a centroid that can fall
 * outside concave polygons or inside holes.
 */
export function representativePointOfPolygon(coordinates: unknown, grid = 24): LngLat | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const outer = ringPositions(coordinates[0]);
  if (outer.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!(minX < maxX && minY < maxY)) return null;

  const inside = (pt: LngLat) => pointInsidePolygon(pt, coordinates);
  const clearance = (pt: LngLat) => {
    let best = minDistToRingSquared(pt, coordinates[0]);
    for (let i = 1; i < coordinates.length; i++) {
      const d = minDistToRingSquared(pt, coordinates[i]);
      if (d < best) best = d;
    }
    return best;
  };

  const center: LngLat = [(minX + maxX) / 2, (minY + maxY) / 2];
  let best = inside(center) ? center : null;
  let bestScore = best ? clearance(best) : -1;

  const n = Math.max(2, Math.floor(grid));
  for (let ix = 0; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      const pt: LngLat = [
        minX + ((ix + 0.5) / n) * (maxX - minX),
        minY + ((iy + 0.5) / n) * (maxY - minY),
      ];
      if (!inside(pt)) continue;
      const score = clearance(pt);
      if (score > bestScore) {
        bestScore = score;
        best = pt;
      }
    }
  }
  return best;
}

/** One marker per MultiPolygon feature: largest component's representative point. */
export function representativePointOfMultiPolygon(coordinates: unknown): LngLat | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  let bestPoly: unknown = null;
  let bestArea = 0;
  for (const poly of coordinates) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const area = Math.abs(ringArea(poly[0]));
    if (area > bestArea) {
      bestArea = area;
      bestPoly = poly;
    }
  }
  if (!bestPoly || bestArea === 0) return null;
  return representativePointOfPolygon(bestPoly);
}

export type SelectionView =
  | { kind: "bounds"; southWest: LngLat; northEast: LngLat }
  | { kind: "point"; at: LngLat }
  | null;

/**
 * How the map should frame a selected feature: full bounds for areas/lines
 * (and GeometryCollection unions), a single center for points or degenerate
 * geometries, null when nothing valid exists. Pure and unit-tested; the
 * component translates this into flyTo/flyToBounds calls.
 */
export function selectionViewForGeometry(g: unknown): SelectionView {
  const pts: LngLat[] = [];
  collectGeometryPositions(g, pts);
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX - minX < 1e-9 && maxY - minY < 1e-9) {
    return { kind: "point", at: [minX, minY] };
  }
  return { kind: "bounds", southWest: [minX, minY], northEast: [maxX, maxY] };
}

/**
 * Valid [x, y] positions of a Point/MultiPoint geometry, in stored
 * (source-CRS) coordinate order. Returns null for any other geometry type
 * (count not applicable) and for missing geometry. An empty array means the
 * geometry is a point type but carries no valid positions — callers must
 * render an unavailable value, never an invented count.
 */
export function pointPositionsOf(g: unknown): LngLat[] | null {
  if (!g || typeof g !== "object") return null;
  const geom = g as { type?: unknown; coordinates?: unknown };
  if (geom.type !== "Point" && geom.type !== "MultiPoint") return null;
  if (geom.type === "Point") {
    return isFinitePair(geom.coordinates) ? [[geom.coordinates[0], geom.coordinates[1]]] : [];
  }
  if (!Array.isArray(geom.coordinates)) return [];
  return (geom.coordinates as unknown[]).filter(isFinitePair).map(([x, y]) => [x, y] as LngLat);
}

/**
 * Number of actual points in a Point/MultiPoint geometry, or null when a
 * count does not apply (other types, missing/empty/malformed geometry).
 */
export function pointCountOf(g: unknown): number | null {
  const pts = pointPositionsOf(g);
  return pts !== null && pts.length > 0 ? pts.length : null;
}

/**
 * The single geometry of one multi-geometry member, derived from the stored
 * parent coordinates (no new data fetched). Supports MultiPolygon (part ->
 * Polygon) and MultiLineString (part -> LineString); null for anything else
 * or an out-of-range index. Used to frame a selected part on the map.
 */
export function partGeometryOf(
  g: unknown,
  index: number,
): { type: string; coordinates: unknown } | null {
  if (!g || typeof g !== "object") return null;
  const geom = g as { type?: unknown; coordinates?: unknown };
  const single =
    geom.type === "MultiPolygon"
      ? "Polygon"
      : geom.type === "MultiLineString"
        ? "LineString"
        : null;
  if (single === null || !Array.isArray(geom.coordinates)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= geom.coordinates.length) return null;
  return { type: single, coordinates: geom.coordinates[index] };
}
