"""Integration: upload valid KML and Shapefile, retrieve info/measurements."""

from __future__ import annotations

import geopandas as gpd
from shapely.geometry import Point, Polygon

from tests.conftest import make_multi_shapefile_zip_bytes


def test_upload_valid_kml(isolated_client, kml_polygon_bytes):
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("survey.kml", kml_polygon_bytes)})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["filename"] == "survey.kml"
    assert body["feature_count"] == 2
    assert body["crs"] == "EPSG:4326"
    assert body["status"] in ("COMPLETED", "COMPLETED_WITH_ERRORS")


def test_upload_valid_shapefile_zip(isolated_client, tmp_dir):
    client, _ = isolated_client
    # Shapefiles hold one geometry type per layer, so the archive carries
    # two layers (polygons + points); the reader concatenates them.
    polys = gpd.GeoDataFrame(
        {"name": ["Plot"]},
        geometry=[Polygon([(77.0, 28.0), (77.001, 28.0), (77.001, 28.001), (77.0, 28.001)])],
        crs="EPSG:4326",
    )
    pts = gpd.GeoDataFrame({"name": ["Marker"]}, geometry=[Point(77.0, 28.0)], crs="EPSG:4326")
    blob = make_multi_shapefile_zip_bytes([(polys, "polys"), (pts, "pts")], tmp_dir)
    r = client.post("/api/files/", files={"file": ("mixed.zip", blob)})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["feature_count"] == 2
    assert body["crs"] == "EPSG:4326"


def test_file_info_roundtrip(isolated_client, kml_polygon_bytes):
    client, _ = isolated_client
    fid = client.post("/api/files/", files={"file": ("a.kml", kml_polygon_bytes)}).json()["id"]
    r = client.get(f"/api/files/{fid}/")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == fid
    assert body["measurement_crs"] is not None
    assert "created_at" in body


def test_file_info_404(isolated_client):
    client, _ = isolated_client
    r = client.get("/api/files/does-not-exist/")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_measurements_content_and_units(isolated_client, kml_mixed_bytes):
    client, _ = isolated_client
    fid = client.post("/api/files/", files={"file": ("m.kml", kml_mixed_bytes)}).json()["id"]
    r = client.get(f"/api/files/{fid}/measurements/")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_id"] == fid
    assert body["source_crs"] == "EPSG:4326"
    assert body["measurement_crs"].startswith("EPSG:326")
    assert body["units"] == {"area": "m²", "length": "m"}
    by_type = {f["geometry_type"]: f for f in body["features"]}
    poly = by_type["Polygon"]
    assert poly["measurement"]["type"] == "area"
    assert poly["measurement"]["unit"] == "m²"
    # ~0.001deg x 0.001deg near Delhi ~ 111m x 97m ~ 10_800 m^2; generous band.
    assert 5000.0 < poly["measurement"]["value"] < 20000.0
    line = by_type["LineString"]
    assert line["measurement"]["type"] == "length"
    assert 50.0 < line["measurement"]["value"] < 200.0
    point = by_type["Point"]
    assert point["measurement"] is None
    assert point["measurement_status"] == "NOT_APPLICABLE"


def test_measurements_pagination(isolated_client, kml_mixed_bytes):
    client, _ = isolated_client
    fid = client.post("/api/files/", files={"file": ("m.kml", kml_mixed_bytes)}).json()["id"]
    p1 = client.get(f"/api/files/{fid}/measurements/", params={"limit": 1, "offset": 0}).json()
    assert p1["total"] == 3
    assert p1["count"] == 1
    assert p1["has_more"] is True
    p2 = client.get(f"/api/files/{fid}/measurements/", params={"limit": 1, "offset": 2}).json()
    assert p2["count"] == 1
    assert p2["has_more"] is False


def test_delete_file(isolated_client, kml_polygon_bytes):
    client, _ = isolated_client
    fid = client.post("/api/files/", files={"file": ("a.kml", kml_polygon_bytes)}).json()["id"]
    assert client.delete(f"/api/files/{fid}/").status_code == 200
    assert client.get(f"/api/files/{fid}/").status_code == 404


def test_health_and_ready(isolated_client):
    client, _ = isolated_client
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json()["status"] == "ready"
