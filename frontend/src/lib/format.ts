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
};

/** Aggregate one measurements page into dashboard totals (page-scoped). */
export function summarize(features: FeatureMeasurement[]): Summary {
  let polygonCount = 0;
  let lineCount = 0;
  let pointCount = 0;
  let totalArea: number | null = null;
  let totalLength: number | null = null;
  for (const f of features) {
    const t = f.geometry_type;
    if (t === "Polygon" || t === "MultiPolygon") polygonCount += 1;
    else if (t === "LineString" || t === "MultiLineString") lineCount += 1;
    else if (t === "Point" || t === "MultiPoint") pointCount += 1;
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
  };
}
