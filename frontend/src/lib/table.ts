import type { FeatureMeasurement } from "./api";
import { areaOf, featureDisplayName, lengthOf } from "./format";
import { pointCountOf } from "./geo";

export type TableSortKey = "feature_id" | "name" | "area" | "length" | "status" | "points" | "parts";

export interface TableQuery {
  text: string;
  typeFilter: string;
  statusFilter: string;
  sortKey: TableSortKey;
  sortDir: 1 | -1;
}

function sortValue(f: FeatureMeasurement, key: TableSortKey): string | number {
  switch (key) {
    case "name":
      return featureDisplayName(f).toLowerCase();
    case "area":
      return areaOf(f) ?? Number.NaN;
    case "length":
      return lengthOf(f) ?? Number.NaN;
    case "points":
      return pointCountOf(f.geometry) ?? Number.NaN;
    case "parts":
      return f.parts?.length ?? Number.NaN;
    case "status":
      return f.measurement_status;
    case "feature_id":
    default:
      return f.feature_id;
  }
}

/** Filter (search + geometry + status) and sort one page of features. Pure. */
export function filterAndSortRows(
  rows: FeatureMeasurement[],
  q: TableQuery,
): FeatureMeasurement[] {
  const needle = q.text.trim().toLowerCase();
  let list = rows.filter((f) => {
    if (q.typeFilter !== "all" && f.geometry_type !== q.typeFilter) return false;
    if (q.statusFilter !== "all" && f.measurement_status !== q.statusFilter) return false;
    if (needle) {
      const hay = `${featureDisplayName(f)} ${f.feature_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  list = [...list];
  list.sort((a, b) => {
    const av = sortValue(a, q.sortKey);
    const bv = sortValue(b, q.sortKey);
    if (typeof av === "number" && typeof bv === "number") {
      const aNaN = Number.isNaN(av);
      const bNaN = Number.isNaN(bv);
      if (aNaN && bNaN) return (a.feature_id - b.feature_id) * q.sortDir;
      if (aNaN) return 1;
      if (bNaN) return -1;
      if (av !== bv) return (av - bv) * q.sortDir;
      return (a.feature_id - b.feature_id) * q.sortDir;
    }
    const cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return cmp * q.sortDir;
    return (a.feature_id - b.feature_id) * q.sortDir;
  });
  return list;
}
