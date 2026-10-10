import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownWideNarrow, ChevronLeft, ChevronRight } from "lucide-react";
import type { MeasurementsPage } from "../lib/api";
import { featureDisplayName, formatMeasurement } from "../lib/format";
import { Badge, Button, Spinner } from "./ui";
import { cn } from "../lib/cn";

interface Props {
  page: MeasurementsPage | null;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onPage: (limit: number, offset: number) => void;
}

type SortKey = "feature_id" | "value";

export function MeasurementTable({ page, loading, selectedId, onSelect, onPage }: Props) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("feature_id");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const rows = useMemo(() => {
    if (!page) return [];
    let list = [...page.features];
    if (typeFilter !== "all") list = list.filter((f) => f.geometry_type === typeFilter);
    if (statusFilter !== "all")
      list = list.filter((f) => f.measurement_status === statusFilter);
    list.sort((a, b) => {
      if (sortKey === "value") {
        const av = a.measurement?.value ?? Number.NaN;
        const bv = b.measurement?.value ?? Number.NaN;
        if (Number.isNaN(av) && Number.isNaN(bv)) return (a.feature_id - b.feature_id) * sortDir;
        if (Number.isNaN(av)) return 1;
        if (Number.isNaN(bv)) return -1;
        return (av - bv) * sortDir;
      }
      return (a.feature_id - b.feature_id) * sortDir;
    });
    return list;
  }, [page, typeFilter, statusFilter, sortKey, sortDir]);

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

  const toggleSort = (key: SortKey) => {
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
        <span className="text-xs text-slate-400">Filters apply to the loaded page.</span>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th sortable onClick={() => toggleSort("feature_id")} active={sortKey === "feature_id"} dir={sortDir}>
                Feature ID
              </Th>
              <Th>Geometry</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th sortable onClick={() => toggleSort("value")} active={sortKey === "value"} dir={sortDir}>
                Value
              </Th>
              <Th>Status</Th>
              <Th>Error details</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center">
                  <Spinner label="Loading measurements" />
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((f) => (
                <tr
                  key={f.feature_id}
                  onClick={() => onSelect(selectedId === f.feature_id ? null : f.feature_id)}
                  aria-selected={selectedId === f.feature_id}
                  className={cn(
                    "cursor-pointer hover:bg-emerald-50 focus-visible:outline-none",
                    selectedId === f.feature_id && "bg-emerald-100/60",
                  )}
                >
                  <td className="px-4 py-2 font-mono">{f.feature_id}</td>
                  <td className="px-4 py-2">
                    <Badge status={f.geometry_type}>{f.geometry_type}</Badge>
                  </td>
                  <td className="max-w-48 truncate px-4 py-2" title={featureDisplayName(f)}>
                    {featureDisplayName(f)}
                  </td>
                  <td className="px-4 py-2">{f.measurement?.type ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{formatMeasurement(f)}</td>
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
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No features match the current filters.
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
