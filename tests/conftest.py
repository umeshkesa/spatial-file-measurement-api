"""Shared pytest fixtures with isolated temp DB and storage."""

from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _build_kml_bytes(placemarks: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        f"<Document>{placemarks}</Document></kml>"
    ).encode()


KML_POLYGON_PM = (
    "<Placemark><name>Plot</name>"
    "<Polygon><outerBoundaryIs><LinearRing><coordinates>"
    "77.0,28.0,0 77.001,28.0,0 77.001,28.001,0 77.0,28.001,0 77.0,28.0,0"
    "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>"
)
KML_LINE_PM = (
    "<Placemark><name>Road</name>"
    "<LineString><coordinates>77.0,28.0,0 77.001,28.0,0</coordinates></LineString></Placemark>"
)
KML_POINT_PM = (
    "<Placemark><name>Marker</name><Point><coordinates>77.0,28.0,0</coordinates></Point>"
    "</Placemark>"
)


def make_shapefile_zip_bytes(gdf, tmp_dir: str | Path, layer: str = "layer") -> bytes:
    """Write a GeoDataFrame as a Shapefile and return zipped bytes."""
    tmp_dir = Path(tmp_dir)
    shp_dir = tmp_dir / layer
    shp_dir.mkdir(parents=True, exist_ok=True)
    shp_path = shp_dir / f"{layer}.shp"
    gdf.to_file(str(shp_path))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(shp_dir.iterdir()):
            zf.write(p, arcname=p.name)
    return buf.getvalue()


def make_multi_shapefile_zip_bytes(layers, tmp_dir: str | Path) -> bytes:
    """Zip several single-geometry-type Shapefile layers into one archive.

    Shapefiles store one geometry type per layer, so mixed-geometry datasets
    are represented as multiple .shp layers (each in its own folder to avoid
    sidecar filename clashes). The reader concatenates all layers.
    ``layers`` is a list of ``(GeoDataFrame, layer_name)`` tuples.
    """
    tmp_dir = Path(tmp_dir)
    root = tmp_dir / "multilayer"
    root.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for gdf, name in layers:
            layer_dir = root / name
            layer_dir.mkdir(parents=True, exist_ok=True)
            shp_path = layer_dir / f"{name}.shp"
            gdf.to_file(str(shp_path))
            for p in sorted(layer_dir.iterdir()):
                zf.write(p, arcname=f"{name}/{p.name}")
    return buf.getvalue()


@pytest.fixture()
def isolated_client(tmp_path, monkeypatch):
    """Yield (TestClient, Settings) bound to an isolated temp SQLite DB."""
    db_path = tmp_path / "test.db"
    storage = tmp_path / "uploads"
    storage.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("STORAGE_DIR", str(storage))

    from app.core.config import get_settings, reset_settings_cache
    from app.db.session import init_db, reset_engine_cache

    reset_settings_cache()
    reset_engine_cache()
    settings = get_settings()
    init_db()

    import app.main as main_module

    app = main_module.create_app()
    client = TestClient(app, raise_server_exceptions=False)
    yield client, settings
    reset_engine_cache()
    reset_settings_cache()


@pytest.fixture()
def kml_polygon_bytes() -> bytes:
    return _build_kml_bytes(KML_POLYGON_PM + KML_POINT_PM)


@pytest.fixture()
def kml_mixed_bytes() -> bytes:
    return _build_kml_bytes(KML_POLYGON_PM + KML_LINE_PM + KML_POINT_PM)


@pytest.fixture()
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d
