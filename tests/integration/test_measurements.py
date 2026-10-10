"""Integration: measurements endpoint, geometry edge cases, persistence."""

from __future__ import annotations

import geopandas as gpd
from shapely.geometry import MultiLineString, MultiPolygon, Polygon

from tests.conftest import (
    _build_kml_bytes,
    make_multi_shapefile_zip_bytes,
    make_shapefile_zip_bytes,
)


def _upload_shapefile(client, gdf, name="t.zip", tmp=None, layer="t"):
    import tempfile

    tmp = tmp or tempfile.mkdtemp()
    blob = make_shapefile_zip_bytes(gdf, tmp, layer)
    r = client.post("/api/files/", files={"file": (name, blob)})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_multipolygon_and_multilinestring(isolated_client, tmp_dir):
    client, _ = isolated_client
    p1 = Polygon([(77.0, 28.0), (77.001, 28.0), (77.001, 28.001), (77.0, 28.001)])
    p2 = Polygon([(77.01, 28.01), (77.011, 28.01), (77.011, 28.011), (77.01, 28.011)])
    mpoly = gpd.GeoDataFrame({"k": [1]}, geometry=[MultiPolygon([p1, p2])], crs="EPSG:4326")
    mline = gpd.GeoDataFrame(
        {"k": [2]},
        geometry=[
            MultiLineString([[(77.0, 28.0), (77.001, 28.0)], [(77.0, 28.0), (77.0, 28.001)]])
        ],
        crs="EPSG:4326",
    )
    blob = make_multi_shapefile_zip_bytes([(mpoly, "mpoly"), (mline, "mline")], tmp_dir)
    r = client.post("/api/files/", files={"file": ("multi.zip", blob)})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    feats = client.get(f"/api/files/{fid}/measurements/").json()["features"]
    by_type = {f["geometry_type"]: f for f in feats}
    assert by_type["MultiPolygon"]["measurement"]["type"] == "area"
    assert by_type["MultiPolygon"]["measurement"]["value"] > 0
    assert by_type["MultiLineString"]["measurement"]["type"] == "length"
    assert by_type["MultiLineString"]["measurement"]["value"] > 0


def test_polygon_with_hole(isolated_client, tmp_dir):
    client, _ = isolated_client
    outer = [(77.0, 28.0), (77.002, 28.0), (77.002, 28.002), (77.0, 28.002)]
    hole = [(77.0005, 28.0005), (77.0015, 28.0005), (77.0015, 28.0015), (77.0005, 28.0015)]
    with_hole = Polygon(outer, [hole])
    solid = Polygon(outer)
    gdf = gpd.GeoDataFrame({"k": [1, 2]}, geometry=[with_hole, solid], crs="EPSG:4326")
    fid = _upload_shapefile(client, gdf, tmp=tmp_dir, layer="hole")
    feats = client.get(f"/api/files/{fid}/measurements/").json()["features"]
    assert feats[0]["measurement"]["value"] < feats[1]["measurement"]["value"]
    assert feats[0]["measurement"]["value"] > 0


def test_empty_geometry_preserved_with_failed_status(isolated_client, tmp_dir):
    client, _ = isolated_client
    gdf = gpd.GeoDataFrame(
        {"k": [1, 2]},
        geometry=[
            Polygon([(77.0, 28.0), (77.001, 28.0), (77.001, 28.001), (77.0, 28.001)]),
            Polygon(),
        ],
        crs="EPSG:4326",
    )
    fid = _upload_shapefile(client, gdf, tmp=tmp_dir, layer="emptyg")
    body = client.get(f"/api/files/{fid}/measurements/").json()
    assert body["total"] == 2
    statuses = {f["feature_id"]: f["measurement_status"] for f in body["features"]}
    assert statuses[0] == "COMPLETED"
    assert statuses[1] == "FAILED"


def test_single_feature_failure_does_not_lose_others(isolated_client):
    """One bad geometry must not discard the good measurements.

    KML MultiGeometry parses as a GeometryCollection (unsupported measurement)
    and an empty-coordinates polygon parses as an empty geometry (FAILED).
    """
    client, _ = isolated_client
    data = _build_kml_bytes(
        "<Placemark><name>Good</name><Polygon><outerBoundaryIs><LinearRing><coordinates>"
        "77.0,28.0,0 77.001,28.0,0 77.001,28.001,0 77.0,28.001,0 77.0,28.0,0"
        "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>"
        "<Placemark><name>Collection</name><MultiGeometry>"
        "<Point><coordinates>77.0,28.0,0</coordinates></Point>"
        "<LineString><coordinates>77.0,28.0,0 77.001,28.0,0</coordinates></LineString>"
        "</MultiGeometry></Placemark>"
        "<Placemark><name>Empty</name><Polygon><outerBoundaryIs><LinearRing><coordinates>"
        "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>"
    )
    r = client.post("/api/files/", files={"file": ("mixfail.kml", data)})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    body = client.get(f"/api/files/{fid}/measurements/").json()
    assert body["total"] == 3
    by_id = {f["feature_id"]: f for f in body["features"]}
    assert by_id[0]["measurement_status"] == "COMPLETED"
    assert by_id[1]["measurement_status"] == "UNSUPPORTED"
    assert by_id[2]["measurement_status"] == "FAILED"
    info = client.get(f"/api/files/{fid}/").json()
    assert info["status"] == "COMPLETED_WITH_ERRORS"


def test_persistence_across_sessions(isolated_client, kml_polygon_bytes):
    """Rows committed to SQLite must survive new sessions/clients."""
    client, settings = isolated_client
    fid = client.post("/api/files/", files={"file": ("p.kml", kml_polygon_bytes)}).json()["id"]

    from app.db.session import get_session_factory

    factory = get_session_factory()
    with factory() as s2:
        from app.repositories import file_repository

        assert file_repository.get(s2, fid) is not None
    # A second HTTP client against the same database file sees the same rows.
    from fastapi.testclient import TestClient

    import app.main as main_module

    client2 = TestClient(main_module.create_app(), raise_server_exceptions=False)
    assert client2.get(f"/api/files/{fid}/").status_code == 200
    assert client2.get(f"/api/files/{fid}/measurements/").json()["total"] == 2


def test_point_handling_in_kml(isolated_client):
    client, _ = isolated_client
    data = _build_kml_bytes(
        "<Placemark><name>M</name><Point><coordinates>77.0,28.0,0</coordinates></Point></Placemark>"
    )
    fid = client.post("/api/files/", files={"file": ("m.kml", data)}).json()["id"]
    feat = client.get(f"/api/files/{fid}/measurements/").json()["features"][0]
    assert feat["geometry_type"] == "Point"
    assert feat["measurement"] is None
    assert feat["measurement_status"] == "NOT_APPLICABLE"


def test_hyderabad_kml_selects_utm_zone_44_end_to_end(isolated_client):
    """Hyderabad (~78.48E, ~17.38N) is in UTM zone 44N: the API must report
    EPSG:32644 as the measurement CRS with a plausible metric area."""
    client, _ = isolated_client
    data = _build_kml_bytes(
        "<Placemark><name>HYD Plot</name><Polygon><outerBoundaryIs><LinearRing><coordinates>"
        "78.48,17.38,0 78.481,17.38,0 78.481,17.381,0 78.48,17.381,0 78.48,17.38,0"
        "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>"
    )
    r = client.post("/api/files/", files={"file": ("hyderabad.kml", data)})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    body = client.get(f"/api/files/{fid}/measurements/").json()
    assert body["source_crs"] == "EPSG:4326"
    assert body["measurement_crs"] == "EPSG:32644"
    feat = body["features"][0]
    assert feat["measurement"]["type"] == "area"
    assert feat["measurement"]["unit"] == "m²"
    # 0.001deg x 0.001deg near Hyderabad ~ 107m x 111m ~ 11,800 m^2.
    assert 5000.0 < feat["measurement"]["value"] < 20000.0
