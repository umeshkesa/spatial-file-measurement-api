"""Generate extra demo samples showcasing every supported geometry type.

Writes (repo-root sample_data/):
  geometry_catalog.kml - Polygon, holed Polygon, LineString, Point,
                         MultiGeometry polygons/lines, empty polygon.
  multipart_shapes.zip - Shapefile layers with one MultiPolygon,
                         one MultiLineString and one MultiPoint feature.
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiLineString, MultiPoint, MultiPolygon, Polygon

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT = REPO_ROOT / "sample_data"
OUT.mkdir(parents=True, exist_ok=True)

LON, LAT = 77.0, 28.0  # Delhi area, matches the existing samples


def ring(x0: float, y0: float, size: float) -> str:
    pts = [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size), (x0, y0)]
    return " ".join(f"{x + LON},{y + LAT},0" for x, y in pts)


CATALOG = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<Placemark><name>Simple Park</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(0, 0, 0.002)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Building With Courtyard</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(0.01, 0.01, 0.002)}</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>{ring(0.0105, 0.0105, 0.001)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
<Placemark><name>Main Road</name><LineString><coordinates>{LON},{LAT},0 {LON + 0.003},{LAT + 0.001},0</coordinates></LineString></Placemark>
<Placemark><name>Entrance Gate</name><Point><coordinates>{LON},{LAT},0</coordinates></Point></Placemark>
<Placemark><name>Two Fields</name><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(0.02, 0.0, 0.001)}</coordinates></LinearRing></outerBoundaryIs></Polygon><Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(0.022, 0.0, 0.001)}</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>
<Placemark><name>Mixed Bag</name><MultiGeometry><Point><coordinates>{LON + 0.03},{LAT},0</coordinates></Point><LineString><coordinates>{LON + 0.03},{LAT},0 {LON + 0.031},{LAT},0</coordinates></LineString></MultiGeometry></Placemark>
<Placemark><name>Broken Outline</name><Polygon><outerBoundaryIs><LinearRing><coordinates></coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>
"""


def main() -> None:
    (OUT / "geometry_catalog.kml").write_text(CATALOG, encoding="utf-8")

    o = 0.05  # offset so demo shapes sit apart from the catalog ones
    layers = {
        "multipolygon": gpd.GeoDataFrame(
            {"name": ["Twin Lakes"]},
            geometry=[
                MultiPolygon(
                    [
                        Polygon(
                            [
                                (LON + o, LAT),
                                (LON + o + 0.001, LAT),
                                (LON + o + 0.001, LAT + 0.001),
                                (LON + o, LAT + 0.001),
                            ]
                        ),
                        Polygon(
                            [
                                (LON + o + 0.002, LAT),
                                (LON + o + 0.003, LAT),
                                (LON + o + 0.003, LAT + 0.001),
                                (LON + o + 0.002, LAT + 0.001),
                            ]
                        ),
                    ]
                )
            ],
            crs="EPSG:4326",
        ),
        "multiline": gpd.GeoDataFrame(
            {"name": ["Ring Road"]},
            geometry=[
                MultiLineString(
                    [
                        [(LON, LAT + o), (LON + 0.001, LAT + o)],
                        [(LON, LAT + o), (LON, LAT + o + 0.001)],
                    ]
                )
            ],
            crs="EPSG:4326",
        ),
        "multipoint": gpd.GeoDataFrame(
            {"name": ["Survey Pegs"]},
            geometry=[MultiPoint([(LON, LAT), (LON + 0.001, LAT), (LON, LAT + 0.001)])],
            crs="EPSG:4326",
        ),
    }
    work = OUT / "_multipart_tmp"
    if work.exists():
        shutil.rmtree(work)
    with zipfile.ZipFile(OUT / "multipart_shapes.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for name, gdf in layers.items():
            layer_dir = work / name
            layer_dir.mkdir(parents=True, exist_ok=True)
            gdf.to_file(str(layer_dir / f"{name}.shp"))
            for p in sorted(layer_dir.iterdir()):
                zf.write(p, arcname=f"{name}/{p.name}")
    shutil.rmtree(work, ignore_errors=True)
    print(f"Wrote {OUT / 'geometry_catalog.kml'} and {OUT / 'multipart_shapes.zip'}")


if __name__ == "__main__":
    main()
