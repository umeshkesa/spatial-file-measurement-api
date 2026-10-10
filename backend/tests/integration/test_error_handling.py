"""Integration: invalid inputs, security limits, error-shape consistency."""

from __future__ import annotations

import io
import zipfile

import geopandas as gpd
from shapely.geometry import Point

from tests.conftest import make_shapefile_zip_bytes


def test_unsupported_extension(isolated_client):
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("data.txt", b"hello")})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_invalid_kml(isolated_client):
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("bad.kml", b"<kml><broken")})
    assert r.status_code == 422
    assert "error" in r.json()


def test_invalid_zip(isolated_client):
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("bad.zip", b"not a zip")})
    assert r.status_code in (400, 422)


def test_missing_crs_shapefile(isolated_client, tmp_dir):
    client, _ = isolated_client
    gdf = gpd.GeoDataFrame({"n": [1]}, geometry=[Point(1.0, 2.0)], crs=None)
    blob = make_shapefile_zip_bytes(gdf, tmp_dir, "nocrs")
    # Strip the .prj sidecar to simulate missing CRS metadata.
    zin = zipfile.ZipFile(io.BytesIO(blob))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for info in zin.infolist():
            if not info.filename.lower().endswith(".prj"):
                zf.writestr(info.filename, zin.read(info.filename))
    r = client.post("/api/files/", files={"file": ("nocrs.zip", buf.getvalue())})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MISSING_CRS"


def test_missing_file_id_404(isolated_client):
    client, _ = isolated_client
    for url in ("/api/files/nope/", "/api/files/nope/measurements/"):
        r = client.get(url)
        assert r.status_code == 404
        body = r.json()
        assert body["error"]["code"] == "NOT_FOUND"
        assert "request_id" in body["error"]


def test_upload_size_limit_enforced(isolated_client, monkeypatch, kml_polygon_bytes):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_bytes", 10)
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("big.kml", kml_polygon_bytes)})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_zip_path_traversal_rejected(isolated_client):
    client, _ = isolated_client
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../evil.txt", "evil")
    r = client.post("/api/files/", files={"file": ("evil.zip", buf.getvalue())})
    assert r.status_code in (400, 422)


def test_error_response_shape_consistent(isolated_client):
    client, _ = isolated_client
    r = client.get("/api/files/missing-id/")
    body = r.json()
    assert set(body["error"].keys()) >= {"code", "message", "request_id"}


def test_transaction_error_handling_leaves_db_usable(isolated_client, kml_polygon_bytes):
    """After a failed upload, the API must still accept valid uploads."""
    client, _ = isolated_client
    bad = client.post("/api/files/", files={"file": ("bad.kml", b"garbage-bytes")})
    assert bad.status_code == 422
    good = client.post("/api/files/", files={"file": ("ok.kml", kml_polygon_bytes)})
    assert good.status_code == 201
