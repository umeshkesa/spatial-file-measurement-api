"""Unit tests for the geospatial reader (KML + ZIP Shapefile)."""

from __future__ import annotations

import io
import zipfile

import geopandas as gpd
import pytest
from shapely.geometry import Point

from app.core.exceptions import InvalidFileError, InvalidGeodataError, MissingCrsError
from app.services import geospatial_reader
from tests.conftest import _build_kml_bytes, make_shapefile_zip_bytes


def test_read_valid_kml(tmp_path):
    data = _build_kml_bytes(
        "<Placemark><name>A</name><Point><coordinates>77.0,28.0,0</coordinates></Point></Placemark>"
    )
    p = tmp_path / "a.kml"
    p.write_bytes(data)
    ds = geospatial_reader.read_dataset(p, "a.kml")
    assert len(ds.gdf) == 1
    assert ds.source_crs == "EPSG:4326"


def test_read_invalid_kml(tmp_path):
    p = tmp_path / "bad.kml"
    p.write_bytes(b"this is not kml at all <<<")
    with pytest.raises(InvalidGeodataError):
        geospatial_reader.read_dataset(p, "bad.kml")


def test_read_valid_shapefile_zip(tmp_path):
    gdf = gpd.GeoDataFrame({"n": ["x"]}, geometry=[Point(77.0, 28.0)], crs="EPSG:4326")
    blob = make_shapefile_zip_bytes(gdf, tmp_path, "pts")
    p = tmp_path / "pts.zip"
    p.write_bytes(blob)
    ds = geospatial_reader.read_dataset(p, "pts.zip")
    assert len(ds.gdf) == 1
    assert ds.source_crs == "EPSG:4326"


def test_shapefile_missing_crs_rejected(tmp_path):
    gdf = gpd.GeoDataFrame({"n": ["x"]}, geometry=[Point(1.0, 2.0)], crs=None)
    # Write manually without .prj: DBF/SHX/SHP via pyogrio still written; drop .prj.
    d = tmp_path / "nocrs"
    d.mkdir()
    gdf.to_file(str(d / "nocrs.shp"))
    for f in d.glob("*.prj"):
        f.unlink()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(d.iterdir()):
            zf.write(f, arcname=f.name)
    p = tmp_path / "nocrs.zip"
    p.write_bytes(buf.getvalue())
    with pytest.raises(MissingCrsError):
        geospatial_reader.read_dataset(p, "nocrs.zip")


def test_invalid_zip_rejected(tmp_path):
    p = tmp_path / "bad.zip"
    p.write_bytes(b"PK not really a zip")
    with pytest.raises(InvalidFileError):
        geospatial_reader.read_dataset(p, "bad.zip")


def test_zip_without_shapefile_rejected(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "hello")
    p = tmp_path / "empty.zip"
    p.write_bytes(buf.getvalue())
    with pytest.raises(InvalidGeodataError):
        geospatial_reader.read_dataset(p, "empty.zip")


def test_zip_path_traversal_blocked(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../evil.shp", "evil")
        zf.writestr("ok.shp", "x")
    p = tmp_path / "evil.zip"
    p.write_bytes(buf.getvalue())
    with pytest.raises(InvalidFileError):
        geospatial_reader.read_dataset(p, "evil.zip")


def test_unsupported_extension_rejected():
    with pytest.raises(InvalidFileError):
        geospatial_reader.validate_extension("data.geojson")


def test_archive_entry_limit_enforced(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(5):
            zf.writestr(f"f{i}.txt", "x")
    p = tmp_path / "many.zip"
    p.write_bytes(buf.getvalue())
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(InvalidFileError):
        geospatial_reader._safe_extract(p, dest, max_entries=2, max_total_bytes=10**9)
