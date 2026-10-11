import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownWideNarrow, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { FeatureMeasurement, MeasurementsPage } from "../lib/api";
import {
  M2_PER_ACRE,
  M2_PER_HECTARE,
  M_PER_KM,
  areaOf,
  assignLandLabels,
  featureDisplayName,
  formatMetric,
  lengthOf,
} from "../lib/format";
import { pointCountOf } from "../lib/geo";
import { filterAndSortRows, type TableSortKey } from "../lib/table";
import { Badge, Button, Spinner } from "./ui";
import { cn } from "../lib/cn";

interface Props {
  page: MeasurementsPage | null;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onPage: (limit: number, offset: number) => void;
  /** Dataset-wide list used for stable Land N numbering across pages. */
  labelSource: FeatureMeasurement[];
}

const COLS = 13;

export function MeasurementTable({ page, loading, selectedId, onSelect, onPage, labelSource }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<TableSortKey>("feature_id");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const labels = useMemo(() => assignLandLabels(labelSource), [labelSource]);

  const rows = useMemo(
    () =>
      page
        ? filterAndSortRows(page.features, { text: query, typeFilter, statusFilter, sortKey, sortDir })
        : [],
    [page, query, typeFilter, statusFilter, sortKey, sortDir],
  );

  const typeOptions = useMemo(
    () => Array.from(new Set((page?.features ?? []).map((f) => f.geometry_type))).sort(),
    [page],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((page?.features ?? []).map((f) => f.measurement_status))).sort(),
    [page],
  );

  if (!page && !loading) return null;

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.limit)) : 1;
  const currentPage = page ? Math.floor(page.offset / page.limit) + 1 : 1;

  const toggleSort = (key: TableSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-slate-600">
          <Search className="h-4 w-4 text-slate-400" aria-hidden />
          <input
            type="search"
            aria-label="Search by feature name or ID"
            placeholder="Search name or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 placeholder:text-slate-400"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Geometry
          <select
            aria-label="Filter by geometry type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
          >
            <option value="all">All</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Status
          <select
            aria-label="Filter by measurement status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
          >
            <option value="all">All</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-slate-400">Search, filters and sorting apply to the loaded page.</span>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Label</Th>
              <Th sortable onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>
                Name
              </Th>
              <Th sortable onClick={() => toggleSort("feature_id")} active={sortKey === "feature_id"} dir={sortDir}>
                ID
              </Th>
              <Th>Geometry</Th>
              <Th sortable onClick={() => toggleSort("area")} active={sortKey === "area"} dir={sortDir}>
                Area m²
              </Th>
              <Th>Area ha</Th>
              <Th>Area ac</Th>
              <Th sortable onClick={() => toggleSort("length")} active={sortKey === "length"} dir={sortDir}>
                Length m
              </Th>
              <Th>Length km</Th>
              <Th sortable onClick={() => toggleSort("points")} active={sortKey === "points"} dir={sortDir}>
                Point count
              </Th>
              <Th sortable onClick={() => toggleSort("parts")} active={sortKey === "parts"} dir={sortDir}>
                Parts
              </Th>
              <Th sortable onClick={() => toggleSort("status")} active={sortKey === "status"} dir={sortDir}>
                Status
              </Th>
              <Th>Error details</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={COLS} className="px-4 py-6 text-center">
                  <Spinner label="Loading measurements" />
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((f) => {
                const area = areaOf(f);
                const length = lengthOf(f);
                const points = pointCountOf(f.geometry);
                return (
                  <tr
                    key={f.feature_id}
                    onClick={() => onSelect(selectedId === f.feature_id ? null : f.feature_id)}
                    aria-selected={selectedId === f.feature_id}
                    className={cn(
                      "cursor-pointer hover:bg-emerald-50 focus-visible:outline-none",
                      selectedId === f.feature_id && "bg-emerald-100/60",
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-semibold text-emerald-800">
                      {labels.get(f.feature_id) ?? "—"}
                    </td>
                    <td className="max-w-48 truncate px-4 py-2" title={featureDisplayName(f)}>
                      {featureDisplayName(f)}
                    </td>
                    <td className="px-4 py-2 font-mono">{f.feature_id}</td>
                    <td className="px-4 py-2">
                      <Badge status={f.geometry_type}>{f.geometry_type}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMetric(area)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatMetric(area != null ? area / M2_PER_HECTARE : null, 4)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatMetric(area != null ? area / M2_PER_ACRE : null, 4)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMetric(length)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatMetric(length != null ? length / M_PER_KM : null, 3)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {points === null ? "—" : String(points)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {f.parts ? String(f.parts.length) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge status={f.measurement_status}>
                        {f.measurement_status.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className="max-w-64 px-4 py-2 text-xs text-slate-500">
                      {f.error_details ? (
                        <span className="flex items-start gap-1" title={f.error_details}>
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
                            aria-label="Measurement error"
                            role="img"
                          />
                          <span className="truncate">{f.error_details}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={COLS} className="px-4 py-6 text-center text-slate-500">
                  {query || typeFilter !== "all" || statusFilter !== "all"
                    ? "No features match the current search or filters."
                    : "This file contains no features."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {page && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <p aria-live="polite">
            Page {currentPage} of {totalPages} — showing {page.count} of {page.total} features
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              Per page
              <select
                aria-label="Rows per page"
                value={page.limit}
                onChange={(e) => onPage(Number(e.target.value), 0)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={page.offset === 0 || loading}
              onClick={() => onPage(page.limit, Math.max(0, page.offset - page.limit))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!page.has_more || loading}
              onClick={() => onPage(page.limit, page.offset + page.limit)}
              aria-label="Next page"
            >
              Next <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  sortable,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: 1 | -1;
  onClick?: () => void;
}) {
  return (
    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {sortable ? (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`Sort by ${children}`}
        >
          {children}
          <ArrowDownWideNarrow
            className={cn("h-3.5 w-3.5", active ? "text-emerald-600" : "text-slate-300")}
            aria-hidden
          />
          {active && <span className="sr-only">{dir === 1 ? "ascending" : "descending"}</span>}
        </button>
      ) : (
        children
      )}
    </th>
  );
}
