import {
  getMeasurements,
  type FeatureMeasurement,
  type FileInfo,
  type MeasurementsPage,
} from "./api";
import {
  M2_PER_ACRE,
  M2_PER_HECTARE,
  M_PER_KM,
  areaOf,
  assignLandLabels,
  featureDisplayName,
  lengthOf,
} from "./format";
import { pointCountOf, pointPositionsOf } from "./geo";

/** Page size used when walking the full measurement list for export. */
export const EXPORT_PAGE_SIZE = 500;

export const CSV_COLUMNS = [
  "file_id",
  "filename",
  "feature_id",
  "label",
  "feature_name",
  "geometry_type",
  "source_crs",
  "measurement_crs",
  "measurement_type",
  "measurement_value",
  "measurement_unit",
  "area_ha",
  "area_acres",
  "length_km",
  "measurement_status",
  "error_details",
  "point_count",
] as const;

export interface ExportBundle {
  file: FileInfo;
  units: Record<string, string>;
  features: FeatureMeasurement[];
}

/** Fetch every measurement page for a file. Throws on any gap or failure —
 *  callers must never present a partial export as complete. */
export async function fetchAllMeasurements(
  fileId: string,
  file: FileInfo,
  onProgress?: (loaded: number, total: number | null) => void,
  fetchPage: (
    id: string,
    limit: number,
    offset: number,
  ) => Promise<MeasurementsPage> = getMeasurements,
): Promise<ExportBundle> {
  const features: FeatureMeasurement[] = [];
  let offset = 0;
  let total: number | null = null;
  let units: Record<string, string> = { area: "m²", length: "m" };
  // Guard against a misbehaving server looping forever.
  let pagesFetched = 0;

  while (true) {
    pagesFetched += 1;
    if (pagesFetched > 10000) {
      throw new Error("Too many measurement pages; aborting export.");
    }
    const page: MeasurementsPage = await fetchPage(fileId, EXPORT_PAGE_SIZE, offset);
    if (page.offset !== offset) {
      throw new Error(
        `Measurement pages are not contiguous (expected offset ${offset}, got ${page.offset}); export aborted.`,
      );
    }
    if (total === null) total = page.total;
    else if (page.total !== total) {
      throw new Error("Feature total changed while exporting; export aborted.");
    }
    if (page.count === 0 && features.length < (total ?? 0)) {
      throw new Error("Server returned an empty page before all rows were read; export aborted.");
    }
    features.push(...page.features);
    units = page.units ?? units;
    onProgress?.(features.length, total);
    if (!page.has_more || features.length >= (total ?? Number.POSITIVE_INFINITY)) break;
    offset += page.count;
  }
  if (features.length !== total) {
    throw new Error(
      `Export incomplete: read ${features.length} of ${total} rows; export aborted.`,
    );
  }
  return { file, units, features };
}

/** Prefix untrusted text that could be interpreted as a spreadsheet formula. */
export function sanitizeFormulaCell(value: string): string {
  // Leading =, +, -, @ (and tab/CR, already CSV-escaped) trigger formula evaluation.
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Escape one CSV cell per RFC 4180, with formula-injection protection. */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "number" ? String(value) : value;
  const safe = sanitizeFormulaCell(raw);
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export interface CsvRow {
  file_id: string;
  filename: string;
  feature_id: number;
  label: string;
  feature_name: string;
  geometry_type: string;
  source_crs: string;
  measurement_crs: string;
  measurement_type: string;
  measurement_value: string;
  measurement_unit: string;
  area_ha: string;
  area_acres: string;
  length_km: string;
  measurement_status: string;
  error_details: string;
  point_count: string;
}

export function toCsvRow(
  fileId: string,
  filename: string,
  sourceCrs: string,
  measurementCrs: string,
  f: FeatureMeasurement,
  label: string,
): CsvRow {
  const area = areaOf(f);
  const length = lengthOf(f);
  const points = pointCountOf(f.geometry);
  return {
    file_id: fileId,
    filename,
    feature_id: f.feature_id,
    label,
    feature_name: featureDisplayName(f),
    geometry_type: f.geometry_type,
    source_crs: sourceCrs,
    measurement_crs: measurementCrs,
    // NOT_APPLICABLE and failed measurements keep an empty value — never zero.
    // (A genuine 0 must still serialize as "0": check for null, not falsiness.)
    measurement_type: f.measurement?.type ?? "",
    measurement_value: f.measurement?.value != null ? String(f.measurement.value) : "",
    measurement_unit: f.measurement?.unit ?? "",
    area_ha: area != null ? String(area / M2_PER_HECTARE) : "",
    area_acres: area != null ? String(area / M2_PER_ACRE) : "",
    length_km: length != null ? String(length / M_PER_KM) : "",
    measurement_status: f.measurement_status,
    error_details: f.error_details ?? "",
    point_count: points === null ? "" : String(points),
  };
}

export function buildCsv(bundle: ExportBundle): string {
  const lines = [CSV_COLUMNS.join(",")];
  const labels = assignLandLabels(bundle.features);
  for (const f of bundle.features) {
    const row = toCsvRow(
      bundle.file.id,
      bundle.file.filename,
      bundle.file.crs ?? "",
      bundle.file.measurement_crs ?? "",
      f,
      labels.get(f.feature_id) ?? "",
    );
    lines.push(CSV_COLUMNS.map((c) => escapeCsvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function buildJsonExport(bundle: ExportBundle): string {
  const labels = assignLandLabels(bundle.features);
  const doc = {
    file_id: bundle.file.id,
    filename: bundle.file.filename,
    feature_count: bundle.file.feature_count,
    source_crs: bundle.file.crs,
    measurement_crs: bundle.file.measurement_crs,
    units: bundle.units,
    status: bundle.file.status,
    created_at: bundle.file.created_at,
    error_summary: bundle.file.error_summary,
    features: bundle.features.map((f) => {
      const area = areaOf(f);
      const length = lengthOf(f);
      return {
        feature_id: f.feature_id,
        label: labels.get(f.feature_id) ?? null,
        feature_name: featureDisplayName(f),
        geometry_type: f.geometry_type,
        geometry: f.geometry,
        properties: f.properties,
        measurement: f.measurement,
        area_ha: area != null ? area / M2_PER_HECTARE : null,
        area_acres: area != null ? area / M2_PER_ACRE : null,
        length_km: length != null ? length / M_PER_KM : null,
        point_count: pointCountOf(f.geometry),
        parts: f.parts ?? null,
        measurement_status: f.measurement_status,
        error_details: f.error_details,
        components: f.components,
      };
    }),
  };
  return JSON.stringify(doc, null, 2);
}

/** `survey.kml` -> `survey_measurements_2026-10-10.csv`. */
export function exportFilename(
  originalFilename: string,
  ext: "csv" | "json",
  now = new Date(),
  suffix = "measurements",
): string {
  const stem = originalFilename.replace(/\.[^.]*$/, "") || "export";
  const safe = stem.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "") || "export";
  const date = now.toISOString().slice(0, 10);
  return `${safe}_${suffix}_${date}.${ext}`;
}

/**
 * One row per multi-geometry part. Part values come from the backend's
 * independent per-part measurement (never divided from the combined total).
 * Single-type features contribute no rows. The feature-level CSV is
 * intentionally left unchanged for compatibility.
 */
export const PARTS_CSV_COLUMNS = [
  "file_id",
  "filename",
  "feature_id",
  "feature_name",
  "parent_geometry_type",
  "part_index",
  "part_label",
  "part_geometry_type",
  "measurement_type",
  "measurement_value",
  "measurement_unit",
  "area_ha",
  "area_acres",
  "length_km",
  "measurement_status",
  "error_details",
] as const;

export function buildPartsCsv(bundle: ExportBundle): string {
  const lines = [PARTS_CSV_COLUMNS.join(",")];
  for (const f of bundle.features) {
    const parts = f.parts ?? [];
    if (parts.length === 0) continue;
    const name = featureDisplayName(f);
    for (const p of parts) {
      const v = p.measurement_value;
      const areaHa =
        p.measurement_type === "area" && v != null ? String(v / M2_PER_HECTARE) : "";
      const areaAc =
        p.measurement_type === "area" && v != null ? String(v / M2_PER_ACRE) : "";
      const lengthKm =
        p.measurement_type === "length" && v != null ? String(v / M_PER_KM) : "";
      const cells = [
        bundle.file.id,
        bundle.file.filename,
        f.feature_id,
        name,
        f.geometry_type,
        p.part_index,
        `Part ${p.part_index + 1}`,
        p.geometry_type,
        p.measurement_type ?? "",
        v != null ? String(v) : "",
        p.measurement_unit ?? "",
        areaHa,
        areaAc,
        lengthKm,
        p.measurement_status,
        p.error_details ?? "",
      ];
      lines.push(cells.map((c) => escapeCsvCell(c)).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * One row per stored point of every Point/MultiPoint feature. X/Y are the
 * exact source-CRS values (longitude/latitude only when the CRS is
 * geographic); the `crs` column says which. Features with no usable
 * positions contribute no rows — never invented coordinates.
 */
export const POINTS_CSV_COLUMNS = [
  "file_id",
  "filename",
  "feature_id",
  "feature_name",
  "geometry_type",
  "point_index",
  "x",
  "y",
  "crs",
] as const;

export function buildPointsCsv(bundle: ExportBundle): string {
  const lines = [POINTS_CSV_COLUMNS.join(",")];
  const crs = bundle.file.crs ?? "";
  for (const f of bundle.features) {
    const pts = pointPositionsOf(f.geometry);
    if (!pts || pts.length === 0) continue;
    const name = featureDisplayName(f);
    pts.forEach(([x, y], i) => {
      const cells = [
        bundle.file.id,
        bundle.file.filename,
        f.feature_id,
        name,
        f.geometry_type,
        i,
        String(x),
        String(y),
        crs,
      ];
      lines.push(cells.map((c) => escapeCsvCell(c)).join(","));
    });
  }
  return lines.join("\r\n") + "\r\n";
}

export function downloadTextFile(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke after the click has been dispatched so the download survives.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
