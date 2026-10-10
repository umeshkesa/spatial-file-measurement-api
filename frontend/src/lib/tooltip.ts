import type { FeatureMeasurement } from "./api";
import { featureDisplayName, formatMeasurement } from "./format";

/** Escape untrusted text (feature names come from uploaded files) for Leaflet HTML tooltips. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Rich hover tooltip for one measurement record, as sanitized HTML for
 * `layer.bindTooltip`. Values come straight from the API record — the
 * frontend never recalculates measurements.
 */
export function buildFeatureTooltipHtml(f: FeatureMeasurement): string {
  const name = escapeHtml(featureDisplayName(f, "Unnamed feature"));
  const geomType = escapeHtml(f.geometry_type);
  const status = escapeHtml(f.measurement_status.replaceAll("_", " "));
  const measurement = escapeHtml(formatMeasurement(f));
  const error = f.error_details ? escapeHtml(f.error_details) : null;

  const rows = [
    `<div class="spatial-tip-title">${name}</div>`,
    `<div class="spatial-tip-row"><span>ID</span><strong>#${f.feature_id} · ${geomType}</strong></div>`,
    `<div class="spatial-tip-row"><span>Measured</span><strong>${measurement}</strong></div>`,
    `<div class="spatial-tip-row"><span>Status</span><strong>${status}</strong></div>`,
  ];
  if (error) rows.push(`<div class="spatial-tip-error">${error}</div>`);
  return rows.join("");
}
