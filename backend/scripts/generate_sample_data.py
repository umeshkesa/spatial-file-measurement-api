"""Generate small deterministic sample datasets for manual testing."""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Polygon

ROOT = Path(__file__).resolve().parent.parent
# Sample data is shared at the repository root (used by the backend and
# by the frontend e2e suite), so go one level above backend/.
OUT = ROOT.parent / "sample_data"
OUT.mkdir(parents=True, exist_ok=True)

KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<Placemark><name>Survey Plot</name><Polygon><outerBoundaryIs><LinearRing><coordinates>77.0,28.0,0 77.001,28.0,0 77.001,28.001,0 77.0,28.001,0 77.0,28.0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Access Road</name><LineString><coordinates>77.0,28.0,0 77.002,28.0,0</coordinates></LineString></Placemark>
<Placemark><name>Gate Marker</name><Point><coordinates>77.0,28.0,0</coordinates></Point></Placemark>
</Document></kml>
"""


def main() -> None:
    (OUT / "survey.kml").write_text(KML, encoding="utf-8")

    polys = gpd.GeoDataFrame(
        {"name": ["Plot A", "Plot B"]},
        geometry=[
            Polygon([(77.0, 28.0), (77.001, 28.0), (77.001, 28.001), (77.0, 28.001)]),
            Polygon([(77.01, 28.01), (77.011, 28.01), (77.011, 28.011), (77.01, 28.011)]),
        ],
        crs="EPSG:4326",
    )
    lines = gpd.GeoDataFrame(
        {"name": ["Drain"]},
        geometry=[LineString([(77.0, 28.0), (77.002, 28.001)])],
        crs="EPSG:4326",
    )
    work = OUT / "_shp_tmp"
    (work / "parcels_poly").mkdir(parents=True, exist_ok=True)
    (work / "parcels_line").mkdir(parents=True, exist_ok=True)
    polys.to_file(str(work / "parcels_poly" / "parcels.shp"))
    lines.to_file(str(work / "parcels_line" / "parcels.shp"))
    with zipfile.ZipFile(OUT / "parcels.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for folder in ("parcels_poly", "parcels_line"):
            for p in sorted((work / folder).iterdir()):
                zf.write(p, arcname=f"{folder}/{p.name}")
    import shutil

    shutil.rmtree(work, ignore_errors=True)
    print(f"Wrote {OUT / 'survey.kml'} and {OUT / 'parcels.zip'}")


if __name__ == "__main__":
    main()
