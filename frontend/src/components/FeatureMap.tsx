import { useEffect, useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Feature as GeoJsonFeature, FeatureCollection, Geometry } from "geojson";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import type { FeatureMeasurement } from "../lib/api";

interface Props {
  features: FeatureMeasurement[];
  selectedId: number | null;
  onSelect: (f: FeatureMeasurement) => void;
  /** Increment to refit the viewport to the feature bounds. */
  fitSignal?: number;
}

type RichProps = { __fid: number; __name: string };
type RichFeature = GeoJsonFeature<Geometry, RichProps>;

function isFinitePair(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

function collectPositions(coords: unknown, out: Array<[number, number]>) {
  if (isFinitePair(coords)) {
    // GeoJSON order is [longitude, latitude]; Leaflet consumes the same order.
    out.push([coords[0], coords[1]]);
  } else if (Array.isArray(coords)) {
    for (const c of coords) collectPositions(c, out);
  }
}

/** Flatten API geometries (incl. GeometryCollection members) to renderable features. */
function toRenderable(features: FeatureMeasurement[]): RichFeature[] {
  const out: RichFeature[] = [];
  for (const f of features) {
    const g = f.geometry as unknown as {
      type?: string;
      coordinates?: unknown;
      geometries?: Array<{ type?: string; coordinates?: unknown }>;
    } | null;
    if (!g || typeof g.type !== "string") continue; // null / empty geometry
    const name =
      (typeof f.properties?.Name === "string" && f.properties.Name) ||
      (typeof f.properties?.name === "string" && f.properties.name) ||
      `Feature ${f.feature_id}`;
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
  return out;
}

function FitBounds({ collection, signal }: { collection: FeatureCollection; signal: number }) {
  const map = useMap();
  useEffect(() => {
    const pts: Array<[number, number]> = [];
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

  const center = useMemo<LatLngExpression>(() => {
    const pts: Array<[number, number]> = [];
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
      <GeoJSON
        key={`${selectedId ?? "none"}-${collection.features.length}`}
        data={collection}
        style={(f) => {
          const selected =
            (f?.properties as RichProps | undefined)?.__fid === selectedId;
          const base = { weight: selected ? 4 : 2, opacity: 1 };
          const t = f?.geometry?.type;
          if (t === "Polygon" || t === "MultiPolygon") {
            return {
              ...base,
              color: selected ? "#047857" : "#059669",
              fillColor: "#10b981",
              fillOpacity: selected ? 0.45 : 0.25,
            };
          }
          return { ...base, color: selected ? "#0369a1" : "#0284c7" };
        }}
        pointToLayer={(_geo, latlng) => {
          const isSelected =
            (_geo as unknown as RichFeature)?.properties?.__fid === selectedId;
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
          layer.bindTooltip(props.__name);
          layer.on("click", () => {
            const full = lookup.get(props.__fid);
            if (full) onSelect(full);
          });
        }}
      />
    </MapContainer>
  );
}
