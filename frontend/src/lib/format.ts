import type { FeatureMeasurement } from "./api";

/** Format a measurement value with units; points show "Not applicable". */
export function formatMeasurement(f: FeatureMeasurement): string {
  if (!f.measurement || f.measurement.value === null) {
    if (f.measurement_status === "NOT_APPLICABLE") return "Not applicable";
    if (f.measurement_status === "PARTIAL") {
      const n = f.components?.length ?? 0;
      const done = f.components?.filter((c) => c.measurement_status === "COMPLETED").length ?? 0;
      return n > 0 ? `Partial — ${done} of ${n} parts measured` : "Partial";
    }
    return "—";
  }
  const v = f.measurement.value;
  const pretty =
    Math.abs(v) >= 10000
      ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `${pretty} ${f.measurement.unit}`;
}

export function featureDisplayName(f: FeatureMeasurement, fallback?: string): string {
  const p = f.properties ?? {};
  for (const key of ["Name", "name", "NAME", "title", "label"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return fallback ?? `Feature ${f.feature_id}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export type Summary = {
  featureCount: number;
  polygonCount: number;
  lineCount: number;
  pointCount: number;
  totalArea: number | null;
  totalLength: number | null;
  failedCount: number;
  unsupportedCount: number;
  partialCount: number;
};

/** Aggregate measurements (page- or dataset-scoped by the caller). */
export function summarize(features: FeatureMeasurement[]): Summary {
  let polygonCount = 0;
  let lineCount = 0;
  let pointCount = 0;
  let totalArea: number | null = null;
  let totalLength: number | null = null;
  let failedCount = 0;
  let unsupportedCount = 0;
  let partialCount = 0;
  for (const f of features) {
    const t = f.geometry_type;
    if (t === "Polygon" || t === "MultiPolygon") polygonCount += 1;
    else if (t === "LineString" || t === "MultiLineString") lineCount += 1;
    else if (t === "Point" || t === "MultiPoint") pointCount += 1;
    if (f.measurement_status === "FAILED") failedCount += 1;
    else if (f.measurement_status === "UNSUPPORTED") unsupportedCount += 1;
    else if (f.measurement_status === "PARTIAL") partialCount += 1;
    if (f.measurement?.value != null) {
      if (f.measurement.type === "area") totalArea = (totalArea ?? 0) + f.measurement.value;
      if (f.measurement.type === "length")
        totalLength = (totalLength ?? 0) + f.measurement.value;
    }
  }
  return {
    featureCount: features.length,
    polygonCount,
    lineCount,
    pointCount,
    totalArea,
    totalLength,
    failedCount,
    unsupportedCount,
    partialCount,
  };
}

// --- Unit conversions (applied to backend values; never recalculated) ---

export const M2_PER_HECTARE = 10_000;
export const M2_PER_ACRE = 4046.8564224;
export const M_PER_KM = 1000;

/** Readable number or "—" for missing values. Genuine 0 renders as "0". */
export function formatMetric(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * Display-only coordinate formatting (6 decimals ≈ 0.1 m at the equator).
 * The underlying value is never modified — show the full value via `title`.
 */
export function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * True when the source CRS expresses positions as longitude/latitude in
 * decimal degrees (EPSG:4326 / WGS 84). Anything else must be presented as
 * plain source-CRS X/Y, never labelled lon/lat.
 */
export function isLonLatCrs(crs: string | null | undefined): boolean {
  if (!crs) return false;
  const s = crs.trim().toLowerCase().replace(/[\s_]+/g, "");
  return s === "epsg:4326" || s === "wgs84" || s === "ogc:crs84" || s === "crs84";
}

/** Area of a feature in m², or null when it has no area measurement. */
export function areaOf(f: FeatureMeasurement): number | null {
  return f.measurement?.type === "area" && f.measurement.value != null
    ? f.measurement.value
    : null;
}

/** Length of a feature in m, or null when it has no length measurement. */
export function lengthOf(f: FeatureMeasurement): number | null {
  return f.measurement?.type === "length" && f.measurement.value != null
    ? f.measurement.value
    : null;
}

/**
 * Generated "Land N" labels for polygon features, numbered in ascending
 * feature-ID order across the given (dataset-wide) list. Original names are
 * never replaced — labels are an additional navigation aid. Returns
 * feature_id -> label for polygon features only.
 */
export function assignLandLabels(features: FeatureMeasurement[]): Map<number, string> {
  const labels = new Map<number, string>();
  const polys = features
    .filter((f) => f.geometry_type === "Polygon" || f.geometry_type === "MultiPolygon")
    .map((f) => f.feature_id)
    .sort((a, b) => a - b);
  polys.forEach((fid, i) => labels.set(fid, `Land ${i + 1}`));
  return labels;
}
