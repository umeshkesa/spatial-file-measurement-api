import { AlertTriangle } from "lucide-react";
import type { FeatureMeasurement, FileInfo, PartMeasurement } from "../lib/api";
import {
  M2_PER_ACRE,
  M2_PER_HECTARE,
  M_PER_KM,
  featureDisplayName,
  formatCoordinate,
  formatMeasurement,
  isLonLatCrs,
} from "../lib/format";
import { pointPositionsOf } from "../lib/geo";
import { Badge, Card, CardBody, CardHeader } from "./ui";
import { cn } from "../lib/cn";

interface Props {
  feature: FeatureMeasurement;
  file: FileInfo;
  /** Currently selected part index (null = whole feature). */
  selectedPartIndex: number | null;
  /** Toggle selection of one part; the parent feature stays selected. */
  onSelectPart: (index: number | null) => void;
}

/** Details for the selected feature. Raw coordinates stay behind a <details>. */
export function FeatureDetailsPanel({ feature, file, selectedPartIndex, onSelectPart }: Props) {
  const entries = Object.entries(feature.properties ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "" && String(v) !== "NaT",
  );
  // Stored source-CRS positions; null = not a point geometry, [] = none usable.
  const pointPositions = pointPositionsOf(feature.geometry);
  const lonLat = isLonLatCrs(file.crs);
  const parts = feature.parts ?? [];
  const partsTitle =
    feature.geometry_type === "MultiPolygon"
      ? "Polygon Parts"
      : feature.geometry_type === "MultiLineString"
        ? "Line Parts"
        : null;

  return (
    <Card aria-label="Selected feature details">
      <CardHeader>
        <h2 className="font-semibold">Selected: {featureDisplayName(feature)}</h2>
        <p className="text-xs text-slate-500">
          Feature {feature.feature_id} · {file.filename}
        </p>
      </CardHeader>
      <CardBody>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Feature ID" value={String(feature.feature_id)} mono />
          <Detail label="Feature name" value={featureDisplayName(feature)} />
          <Detail
            label="Geometry type"
            value={<Badge status={feature.geometry_type}>{feature.geometry_type}</Badge>}
          />
          <Detail
            label="Measurement"
            value={formatMeasurement(feature)}
            strong
          />
          <Detail label="Measurement type" value={feature.measurement?.type ?? "—"} />
          <Detail label="Unit" value={feature.measurement?.unit ?? "—"} />
          <Detail
            label="Point count"
            value={pointPositions !== null && pointPositions.length > 0 ? String(pointPositions.length) : "—"}
          />
          <Detail
            label="Status"
            value={
              <Badge status={feature.measurement_status}>
                {feature.measurement_status.replaceAll("_", " ")}
              </Badge>
            }
          />
          <Detail label="Source CRS" value={file.crs ?? "unknown"} mono />
          <Detail label="Measurement CRS" value={file.measurement_crs ?? "—"} mono />
        </dl>

        {feature.error_details && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{feature.error_details}</span>
          </p>
        )}

        {feature.components && feature.components.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Collection components ({feature.components.length})
            </p>
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {feature.components.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge status={c.geometry_type}>{c.geometry_type}</Badge>
                    <span className="font-medium">
                      {c.measurement_value != null && c.measurement_unit
                        ? `${c.measurement_value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c.measurement_unit}`
                        : c.measurement_status === "NOT_APPLICABLE"
                          ? "Not applicable"
                          : "—"}
                    </span>
                  </span>
                  <Badge status={c.measurement_status}>
                    {c.measurement_status.replaceAll("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {partsTitle !== null && parts.length > 0 && (
          <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs" open>
            <summary className="cursor-pointer font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
              {partsTitle} ({parts.length})
            </summary>
            <p className="mt-2 text-slate-500">
              Parts of {featureDisplayName(feature)} (feature {feature.feature_id}), each
              measured independently in {file.measurement_crs ?? "the measurement CRS"}.
              Click a part to frame it on the map.
            </p>
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {parts.map((p) => (
                <li key={p.part_index}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectPart(selectedPartIndex === p.part_index ? null : p.part_index)
                    }
                    aria-pressed={selectedPartIndex === p.part_index}
                    className={cn(
                      "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                      selectedPartIndex === p.part_index && "bg-emerald-100/60",
                    )}
                  >
                    <span className="font-semibold text-emerald-800">Part {p.part_index + 1}</span>
                    <span className="font-medium tabular-nums">{formatPartValue(p)}</span>
                    <Badge status={p.measurement_status}>
                      {p.measurement_status.replaceAll("_", " ")}
                    </Badge>
                  </button>
                  {p.error_details && (
                    <p className="px-3 pb-1.5 text-xs text-amber-700">{p.error_details}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {pointPositions !== null && (
          <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
              Coordinates ({pointPositions.length} {pointPositions.length === 1 ? "point" : "points"})
            </summary>
            {pointPositions.length === 0 ? (
              <p className="mt-2 text-slate-500">
                No usable coordinates stored for this {feature.geometry_type} geometry.
              </p>
            ) : (
              <>
                <p className="mt-2 text-slate-500">
                  {lonLat
                    ? "Longitude, latitude in decimal degrees (source CRS EPSG:4326) — same values as rendered on the map."
                    : `X, Y in source coordinates (${file.crs ?? "unknown CRS"}) — not longitude/latitude. Same values as rendered on the map.`}
                </p>
                <table className="mt-1 w-full text-left tabular-nums">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-1 pr-2 font-medium">#</th>
                      <th className="py-1 pr-2 font-medium">{lonLat ? "Longitude (°)" : "X"}</th>
                      <th className="py-1 font-medium">{lonLat ? "Latitude (°)" : "Y"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pointPositions.map(([x, y], i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2 text-slate-500">{i}</td>
                        <td className="py-1 pr-2" title={String(x)}>{formatCoordinate(x)}</td>
                        <td className="py-1" title={String(y)}>{formatCoordinate(y)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </details>
        )}

        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Properties ({entries.length})
          </p>
          {entries.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No attribute values on this feature.</p>
          ) : (
            <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {entries.slice(0, 12).map(([k, v]) => (
                <div key={k} className="flex min-w-0 justify-between gap-2 border-b border-slate-100 py-1">
                  <dt className="truncate text-slate-500" title={k}>
                    {k}
                  </dt>
                  <dd className="truncate font-medium" title={String(v)}>
                    {String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {entries.length > 12 && (
            <p className="mt-1 text-xs text-slate-400">+ {entries.length - 12} more in raw JSON below.</p>
          )}
        </div>

        <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            Technical details (raw geometry &amp; properties JSON)
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(
              { geometry: feature.geometry, properties: feature.properties },
              null,
              2,
            )}
          </pre>
        </details>
      </CardBody>
    </Card>
  );
}

/** One part's measurement in native + converted units; "—" when unmeasured. */
function formatPartValue(p: PartMeasurement): string {
  if (p.measurement_value === null || p.measurement_value === undefined) return "—";
  const v = p.measurement_value;
  if (p.measurement_type === "area") {
    const m2 = v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const ha = (v / M2_PER_HECTARE).toLocaleString("en-US", { maximumFractionDigits: 4 });
    const ac = (v / M2_PER_ACRE).toLocaleString("en-US", { maximumFractionDigits: 4 });
    return `${m2} m² · ${ha} ha · ${ac} ac`;
  }
  if (p.measurement_type === "length") {
    const m = v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const km = (v / M_PER_KM).toLocaleString("en-US", { maximumFractionDigits: 3 });
    return `${m} m · ${km} km`;
  }
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${p.measurement_unit ?? ""}`.trim();
}

function Detail({ label, value, mono, strong }: { label: string; value: React.ReactNode; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-slate-100 py-1">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={["truncate text-right", mono && "font-mono text-xs", strong && "font-semibold"].filter(Boolean).join(" ")}>
        {value}
      </dd>
    </div>
  );
}
