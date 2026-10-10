import {
  getMeasurements,
  type FeatureMeasurement,
  type FileInfo,
  type MeasurementsPage,
} from "./api";
import { featureDisplayName } from "./format";

/** Page size used when walking the full measurement list for export. */
export const EXPORT_PAGE_SIZE = 500;

export const CSV_COLUMNS = [
  "file_id",
  "filename",
  "feature_id",
  "feature_name",
  "geometry_type",
  "source_crs",
  "measurement_crs",
  "measurement_type",
  "measurement_value",
  "measurement_unit",
  "measurement_status",
  "error_details",
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
  feature_name: string;
  geometry_type: string;
  source_crs: string;
  measurement_crs: string;
  measurement_type: string;
  measurement_value: string;
  measurement_unit: string;
  measurement_status: string;
  error_details: string;
}

export function toCsvRow(
  fileId: string,
  filename: string,
  sourceCrs: string,
  measurementCrs: string,
  f: FeatureMeasurement,
): CsvRow {
  return {
    file_id: fileId,
    filename,
    feature_id: f.feature_id,
    feature_name: featureDisplayName(f),
    geometry_type: f.geometry_type,
    source_crs: sourceCrs,
    measurement_crs: measurementCrs,
    // NOT_APPLICABLE and failed measurements keep an empty value — never zero.
    // (A genuine 0 must still serialize as "0": check for null, not falsiness.)
    measurement_type: f.measurement?.type ?? "",
    measurement_value: f.measurement?.value != null ? String(f.measurement.value) : "",
    measurement_unit: f.measurement?.unit ?? "",
    measurement_status: f.measurement_status,
    error_details: f.error_details ?? "",
  };
}

export function buildCsv(bundle: ExportBundle): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const f of bundle.features) {
    const row = toCsvRow(
      bundle.file.id,
      bundle.file.filename,
      bundle.file.crs ?? "",
      bundle.file.measurement_crs ?? "",
      f,
    );
    lines.push(CSV_COLUMNS.map((c) => escapeCsvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function buildJsonExport(bundle: ExportBundle): string {
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
    features: bundle.features.map((f) => ({
      feature_id: f.feature_id,
      feature_name: featureDisplayName(f),
      geometry_type: f.geometry_type,
      geometry: f.geometry,
      properties: f.properties,
      measurement: f.measurement,
      measurement_status: f.measurement_status,
      error_details: f.error_details,
      components: f.components,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/** `survey.kml` -> `survey_measurements_2026-10-10.csv`. */
export function exportFilename(originalFilename: string, ext: "csv" | "json", now = new Date()): string {
  const stem = originalFilename.replace(/\.[^.]*$/, "") || "export";
  const safe = stem.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "") || "export";
  const date = now.toISOString().slice(0, 10);
  return `${safe}_measurements_${date}.${ext}`;
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
