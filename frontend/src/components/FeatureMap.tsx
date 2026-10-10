import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Feature as GeoJsonFeature, FeatureCollection, Geometry } from "geojson";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import type { FeatureMeasurement } from "../lib/api";
import { formatMeasurement } from "../lib/format";
import {
  collectGeometryPositions,
  collectPositions,
  representativePointOfMultiPolygon,
  representativePointOfPolygon,
  type LngLat,
} from "../lib/geo";
import { buildFeatureTooltipHtml } from "../lib/tooltip";

interface Props {
  features: FeatureMeasurement[];
  selectedId: number | null;
  onSelect: (f: FeatureMeasurement) => void;
  /** Increment to refit the viewport to the feature bounds. */
  fitSignal?: number;
}

type RichProps = { __fid: number; __name: string };
type RichFeature = GeoJsonFeature<Geometry, RichProps>;

/** Permanent labels stay readable: cap them so large datasets don't drown. */
const MAX_PERMANENT_LABELS = 25;
/** Zoom at/above which labels switch from compact names to name + measurement. */
const DETAILED_ZOOM = 15;

interface RawGeometry {
  type?: string;
  coordinates?: unknown;
  geometries?: Array<{ type?: string; coordinates?: unknown }>;
}

function readGeometry(f: FeatureMeasurement): RawGeometry | null {
  const g = f.geometry as unknown as RawGeometry | null;
  if (!g || typeof g.type !== "string") return null; // null / empty geometry
  return g;
}

function displayName(f: FeatureMeasurement): string {
  return (
    (typeof f.properties?.Name === "string" && f.properties.Name) ||
    (typeof f.properties?.name === "string" && f.properties.name) ||
    `Feature ${f.feature_id}`
  );
}

/** Draw order rank so fills sit below lines and points stay on top. */
function drawRank(type: string): number {
  if (type === "Polygon" || type === "MultiPolygon") return 0;
  if (type === "LineString" || type === "MultiLineString") return 1;
  return 2;
}

/** Flatten API geometries (incl. GeometryCollection members) to renderable features. */
function toRenderable(features: FeatureMeasurement[]): RichFeature[] {
  const out: RichFeature[] = [];
  for (const f of features) {
    const g = readGeometry(f);
    if (!g?.type) continue;
    const name = displayName(f);
    if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
      for (const part of g.geometries) {
        if (!part || typeof part.type !== "string" || part.coordinates === undefined) continue;
        try {
          out.push({
            type: "Feature",
            geometry: { type: part.type, coordinates: part.coordinates } as Geometry,
            properties: { __fid: f.feature_id, __name: name },
          });
        } catch {
          /* skip invalid member */
        }
      }
      continue;
    }
    if (g.coordinates === undefined) continue;
    try {
      out.push({
        type: "Feature",
        geometry: { type: g.type, coordinates: g.coordinates } as Geometry,
        properties: { __fid: f.feature_id, __name: name },
      });
    } catch {
      /* skip invalid geometry */
    }
  }
  // Stable sort: polygons first, then lines, then points — overlapping
  // geometries stay distinguishable at every zoom level.
  return out
    .map((feat, index) => ({ feat, index }))
    .sort(
      (a, b) =>
        drawRank(a.feat.geometry.type) - drawRank(b.feat.geometry.type) || a.index - b.index,
    )
    .map(({ feat }) => feat);
}

interface PolyMarker {
  fid: number;
  position: [number, number];
  record: FeatureMeasurement;
  shortName: string;
  detail: string;
}

/** One interior marker per Polygon/MultiPolygon feature (never a bare centroid). */
function toPolyMarkers(features: FeatureMeasurement[]): PolyMarker[] {
  const out: PolyMarker[] = [];
  for (const f of features) {
    const g = readGeometry(f);
    if (!g?.type || g.coordinates === undefined) continue;
    const inside =
      g.type === "Polygon"
        ? representativePointOfPolygon(g.coordinates)
        : g.type === "MultiPolygon"
          ? representativePointOfMultiPolygon(g.coordinates)
          : null;
    if (!inside) continue;
    const name = displayName(f);
    out.push({
      fid: f.feature_id,
      position: [inside[1], inside[0]],
      record: f,
      shortName: name.length > 30 ? `${name.slice(0, 29)}…` : name,
      detail: formatMeasurement(f),
    });
  }
  return out;
}

function FitBounds({ collection, signal }: { collection: FeatureCollection; signal: number }) {
  const map = useMap();
  useEffect(() => {
    const pts: LngLat[] = [];
    for (const f of collection.features) {
      const geom = f.geometry as unknown as { coordinates?: unknown };
      if (geom?.coordinates !== undefined) collectPositions(geom.coordinates, pts);
    }
    if (pts.length === 0) return;
    const latlngs = pts.map(([lng, lat]) => [lat, lng] as [number, number]);
    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
  }, [collection, map, signal]);
  return null;
}

function ZoomTracker({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => onZoom(map.getZoom());
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map, onZoom]);
  return null;
}

/** Pan/zoom to a table-selected feature only when it is outside the viewport,
 *  keeping nearby context visible instead of hiding it. */
function ZoomToSelection({
  features,
  selectedId,
}: {
  features: FeatureMeasurement[];
  selectedId: number | null;
}) {
  const map = useMap();
  const lastFlown = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      lastFlown.current = null;
      return;
    }
    if (lastFlown.current === selectedId) return;
    lastFlown.current = selectedId;
    const record = features.find((f) => f.feature_id === selectedId);
    if (!record) return;
    const pts: LngLat[] = [];
    collectGeometryPositions(record.geometry, pts);
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts.map(([lng, lat]) => [lat, lng] as [number, number]));
    if (!bounds.isValid()) return;
    try {
      if (!map.getBounds().contains(bounds)) {
        map.flyToBounds(bounds.pad(0.35), { maxZoom: 17, duration: 0.7 });
      }
    } catch {
      /* invalid bounds on exotic geometries: leave the view alone */
    }
  }, [features, selectedId, map]);
  return null;
}

/** React-rendered hover card for polygon center markers (auto-escaped). */
function MarkerTip({ record }: { record: FeatureMeasurement }) {
  const name =
    (typeof record.properties?.Name === "string" && record.properties.Name) ||
    (typeof record.properties?.name === "string" && record.properties.name) ||
    "Unnamed feature";
  return (
    <div>
      <div className="spatial-tip-title">{name}</div>
      <div className="spatial-tip-row">
        <span>ID</span>
        <strong>
          #{record.feature_id} · {record.geometry_type}
        </strong>
      </div>
      <div className="spatial-tip-row">
        <span>Measured</span>
        <strong>{formatMeasurement(record)}</strong>
      </div>
      <div className="spatial-tip-row">
        <span>Status</span>
        <strong>{record.measurement_status.replaceAll("_", " ")}</strong>
      </div>
      {record.error_details && <div className="spatial-tip-error">{record.error_details}</div>}
    </div>
  );
}

export function FeatureMap({ features, selectedId, onSelect, fitSignal = 0 }: Props) {
  const collection = useMemo<FeatureCollection>(
    () => ({ type: "FeatureCollection", features: toRenderable(features) }),
    [features],
  );

  const lookup = useMemo(() => {
    const m = new Map<number, FeatureMeasurement>();
    for (const f of features) m.set(f.feature_id, f);
    return m;
  }, [features]);

  const markers = useMemo(() => toPolyMarkers(features), [features]);
  const showLabels = markers.length > 0 && markers.length <= MAX_PERMANENT_LABELS;

  const [zoom, setZoom] = useState(13);
  const handleZoom = useCallback((z: number) => setZoom(z), []);
  const detailed = zoom >= DETAILED_ZOOM;

  const polyIcon = useMemo(
    () =>
      L.divIcon({
        className: "poly-marker-wrap",
        html: '<div class="poly-marker"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );
  const polyIconSelected = useMemo(
    () =>
      L.divIcon({
        className: "poly-marker-wrap",
        html: '<div class="poly-marker selected"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    [],
  );

  const center = useMemo<LatLngExpression>(() => {
    const pts: LngLat[] = [];
    for (const f of collection.features) {
      const geom = f.geometry as unknown as { coordinates?: unknown };
      if (geom?.coordinates !== undefined) collectPositions(geom.coordinates, pts);
    }
    if (pts.length === 0) return [20, 0];
    const [lng, lat] = pts[0];
    return [lat, lng];
  }, [collection]);

  if (collection.features.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">
        No renderable geometries on this page (empty or unsupported geometries are listed in the
        table below).
      </div>
    );
  }

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      className="h-80 w-full rounded-xl sm:h-96"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds collection={collection} signal={fitSignal} />
      <ZoomTracker onZoom={handleZoom} />
      <ZoomToSelection features={features} selectedId={selectedId} />
      <GeoJSON
        key={`${selectedId ?? "none"}-${collection.features.length}`}
        data={collection}
        style={(f) => {
          const selected =
            (f?.properties as RichProps | undefined)?.__fid === selectedId;
          const t = f?.geometry?.type;
          if (t === "Polygon" || t === "MultiPolygon") {
            return {
              weight: selected ? 5 : 3,
              opacity: 1,
              color: selected ? "#065f46" : "#047857",
              fillColor: "#10b981",
              fillOpacity: selected ? 0.55 : 0.35,
            };
          }
          return {
            weight: selected ? 4 : 2,
            opacity: 1,
            color: selected ? "#0369a1" : "#0284c7",
          };
        }}
        pointToLayer={(geo, latlng) => {
          const isSelected =
            (geo as unknown as RichFeature)?.properties?.__fid === selectedId;
          return L.circleMarker(latlng, {
            radius: isSelected ? 9 : 6,
            color: "#ea580c",
            weight: 2,
            fillColor: "#fb923c",
            fillOpacity: 0.9,
          });
        }}
        onEachFeature={(f, layer) => {
          const props = (f as unknown as RichFeature).properties;
          // Hover tooltip: full measurement record matched by feature ID
          // (GeometryCollection members share their parent's record).
          // Hover never touches selection state — click below owns that.
          const record = lookup.get(props.__fid);
          layer.bindTooltip(
            record ? buildFeatureTooltipHtml(record) : props.__name,
            { sticky: true, direction: "top", className: "spatial-tooltip", opacity: 1 },
          );
          layer.on("click", () => {
            const full = lookup.get(props.__fid);
            if (full) onSelect(full);
          });
        }}
      />
      {markers.map((m) => (
        <Marker
          key={`poly-${m.fid}`}
          position={m.position}
          icon={m.fid === selectedId ? polyIconSelected : polyIcon}
          eventHandlers={{ click: () => onSelect(m.record) }}
          alt={`Center marker for ${m.shortName}`}
        >
          {showLabels &&
            (detailed ? (
              <Tooltip
                permanent
                direction="top"
                offset={[0, -12]}
                opacity={1}
                className="poly-label-detailed"
              >
                <div className="poly-label-name">{m.shortName}</div>
                <div className="poly-label-detail">{m.detail}</div>
              </Tooltip>
            ) : (
              <Tooltip permanent direction="top" offset={[0, -12]} opacity={1} className="poly-label">
                {m.shortName}
              </Tooltip>
            ))}
          <Tooltip sticky direction="top" className="spatial-tooltip" opacity={1}>
            <MarkerTip record={m.record} />
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
