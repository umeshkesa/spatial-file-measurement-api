import { AlertTriangle, Boxes, FileStack, MapPin, Ruler, ShieldAlert, SquareDashed } from "lucide-react";
import type { FeatureMeasurement, FileInfo, MeasurementsPage } from "../lib/api";
import { formatDateTime, summarize } from "../lib/format";
import { Badge, Card, CardBody, CardHeader, Skeleton } from "./ui";
import { MapCard } from "./MapCard";
import { MeasurementTable } from "./MeasurementTable";

interface Props {
  file: FileInfo | null;
  page: MeasurementsPage | null;
  sessionUploads: number;
  loading: boolean;
  mapFeatures: FeatureMeasurement[];
  mapLoading: boolean;
  mapError: string | null;
  onRetryMap: () => void;
  selectedId: number | null;
  onSelectFeature: (f: FeatureMeasurement) => void;
  /** Full feature list when already fetched; totals prefer it over the page. */
  allFeatures: FeatureMeasurement[] | null;
  pageLoading: boolean;
  onPage: (limit: number, offset: number) => void;
  labelSource: FeatureMeasurement[];
  onSelectId: (id: number | null) => void;
  /** Optional single-part geometry to frame instead of the whole feature. */
  focusGeometry?: unknown;
  /** Stable key for focusGeometry (e.g. "fid:partIndex"). */
  focusKey?: string | null;
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="truncate text-lg font-bold text-slate-900" title={value}>
            {value}
          </p>
          {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

function StatSkeleton() {
  return (
    <Card>
      <CardBody className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-40" />
      </CardBody>
    </Card>
  );
}

export function Dashboard({
  file,
  page,
  sessionUploads,
  loading,
  mapFeatures,
  mapLoading,
  mapError,
  onRetryMap,
  selectedId,
  onSelectFeature,
  allFeatures,
  pageLoading,
  onPage,
  labelSource,
  onSelectId,
  focusGeometry,
  focusKey,
}: Props) {
  if (loading && !file) {
    return (
      <div className="space-y-4" aria-label="Loading dashboard">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
        <Card>
          <CardBody>
            <Skeleton className="h-80 w-full" />
          </CardBody>
        </Card>
      </div>
    );
  }

  // Totals use the full dataset when already fetched (map/export cache);
  // otherwise they honestly describe only the loaded page.
  const totalsSource = allFeatures ?? page?.features ?? null;
  const scope = allFeatures ? "dataset total" : "loaded page total";
  const summary = totalsSource ? summarize(totalsSource) : null;
  const areaUnit = page?.units?.area ?? "m²";
  const lengthUnit = page?.units?.length ?? "m";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          icon={<FileStack className="h-5 w-5" aria-hidden />}
          label="Files uploaded (this session)"
          value={String(sessionUploads)}
          sub={file ? `Selected: ${file.filename}` : "Upload a file to begin"}
        />
        <Stat
          icon={<Boxes className="h-5 w-5" aria-hidden />}
          label="Features (selected file)"
          value={file ? String(file.feature_count) : "—"}
          sub={page ? `Showing ${page.count} of ${page.total} on this page` : undefined}
        />
        <Stat
          icon={<SquareDashed className="h-5 w-5" aria-hidden />}
          label={`Total polygon area (${areaUnit})`}
          value={
            summary?.totalArea != null
              ? summary.totalArea.toLocaleString("en-US", { maximumFractionDigits: 2 })
              : "—"
          }
          sub={summary ? `${scope} · ${summary.polygonCount} valid polygon features` : undefined}
        />
        <Stat
          icon={<Ruler className="h-5 w-5" aria-hidden />}
          label={`Total line length (${lengthUnit})`}
          value={
            summary?.totalLength != null
              ? summary.totalLength.toLocaleString("en-US", { maximumFractionDigits: 2 })
              : "—"
          }
          sub={summary ? `${scope} · ${summary.lineCount} valid line features` : undefined}
        />
        <Stat
          icon={<MapPin className="h-5 w-5" aria-hidden />}
          label="Point features"
          value={summary ? String(summary.pointCount) : "—"}
          sub="Points report Not applicable"
        />
        <Stat
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          label="Failed features"
          value={summary ? String(summary.failedCount) : "—"}
          sub={summary && summary.failedCount > 0 ? "Excluded from totals" : "None — all processed"}
        />
        <Stat
          icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
          label="Unsupported features"
          value={summary ? String(summary.unsupportedCount) : "—"}
          sub={summary && summary.partialCount > 0 ? `${summary.partialCount} partially measured` : "Preserved with reasons"}
        />
        <Card>
          <CardBody className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <Boxes className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                CRS &amp; status
              </p>
              {file ? (
                <div className="mt-1 space-y-1">
                  <p className="text-slate-700">
                    Source <code className="font-semibold">{file.crs ?? "unknown"}</code> →
                    measured in <code className="font-semibold">{file.measurement_crs ?? "—"}</code>
                  </p>
                  <p>
                    <Badge status={file.status}>{file.status.replaceAll("_", " ")}</Badge>
                  </p>
                  <p className="text-xs text-slate-500">{formatDateTime(file.created_at)}</p>
                  {file.error_summary && (
                    <p className="text-xs text-amber-700">{file.error_summary}</p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-slate-500">No file selected yet.</p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <MapCard
        title="Dataset preview"
        subtitle={
          file
            ? `${file.filename} · click a geometry to inspect it`
            : undefined
        }
        features={mapFeatures}
        totalCount={file?.feature_count ?? null}
        loading={mapLoading}
        error={mapError}
        onRetry={onRetryMap}
        selectedId={selectedId}
        onSelect={onSelectFeature}
        emptyHint="Upload a .kml file or .zip Shapefile archive and its real geometries will appear here — nothing is shown until then."
        focusGeometry={focusGeometry}
        focusKey={focusKey}
      />

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Feature-wise measurement results</h2>
          <p className="text-xs text-slate-500">
            Every feature from {file?.filename ?? "the file"} with its own measurement.
            Click a row to highlight it on the map.
          </p>
        </CardHeader>
        <CardBody>
          <MeasurementTable
            page={page}
            loading={pageLoading}
            selectedId={selectedId}
            onSelect={onSelectId}
            onPage={onPage}
            labelSource={labelSource}
          />
        </CardBody>
      </Card>
    </div>
  );
}
