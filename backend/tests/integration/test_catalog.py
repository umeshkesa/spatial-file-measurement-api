"""Regression tests using the exact sample_data/geometry_catalog.kml fixture.

Covers all seven placemarks: plain polygon, polygon with hole, line, point,
multi-polygon MultiGeometry, heterogeneous MultiGeometry, empty polygon.
"""

from __future__ import annotations

from pathlib import Path

FIXTURE = (
    Path(__file__).resolve().parent.parent.parent.parent / "sample_data" / "geometry_catalog.kml"
)


def _upload_catalog(client):
    assert FIXTURE.exists(), f"missing fixture: {FIXTURE}"
    r = client.post("/api/files/", files={"file": ("geometry_catalog.kml", FIXTURE.read_bytes())})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    body = client.get(f"/api/files/{fid}/measurements/?limit=100&offset=0").json()
    assert body["total"] == 7
    return fid, {f["feature_id"]: f for f in body["features"]}


def test_catalog_reports_seven_features_with_mixed_statuses(isolated_client):
    client, _ = isolated_client
    fid, by_id = _upload_catalog(client)
    assert [by_id[i]["geometry_type"] for i in range(7)] == [
        "Polygon",
        "Polygon",
        "LineString",
        "Point",
        "MultiPolygon",
        "GeometryCollection",
        "Polygon",
    ]
    assert by_id[6]["measurement_status"] == "FAILED"  # Broken Outline
    assert by_id[5]["measurement_status"] == "PARTIAL"  # Mixed Bag
    info = client.get(f"/api/files/{fid}/").json()
    assert info["status"] == "COMPLETED_WITH_ERRORS"
    assert info["feature_count"] == 7


def test_courtyard_area_excludes_inner_ring(isolated_client):
    """Holed polygon must equal the plain square minus the hole (3/4)."""
    import pytest

    client, _ = isolated_client
    _, by_id = _upload_catalog(client)
    assert by_id[0]["measurement"]["type"] == "area"
    assert by_id[1]["measurement"]["type"] == "area"
    assert by_id[1]["measurement"]["value"] == pytest.approx(
        by_id[0]["measurement"]["value"] * 0.75, rel=1e-3
    )
    # The 1e-3 (not exact) tolerance is honest: UTM scale varies slightly
    # with position, so the hole subtracts ~0.74994, not exactly 0.75.
    assert 30000.0 < by_id[1]["measurement"]["value"] < 35000.0


def test_two_fields_measures_both_polygons(isolated_client):
    client, _ = isolated_client
    _, by_id = _upload_catalog(client)
    two = by_id[4]
    assert two["measurement"]["type"] == "area"
    # Two 0.001deg squares: twice the ~10.9k m^2 single-parcel area.
    assert 20000.0 < two["measurement"]["value"] < 24000.0
    assert two["components"] is None  # merged MultiPolygon needs no breakdown


def test_mixed_bag_partial_components(isolated_client):
    client, _ = isolated_client
    _, by_id = _upload_catalog(client)
    mixed = by_id[5]
    assert mixed["measurement"] is None  # no single invented value
    assert mixed["error_details"] is None  # partial success is not an error
    components = {c["geometry_type"]: c for c in mixed["components"]}
    assert set(components) == {"Point", "LineString"}
    assert components["Point"]["measurement_status"] == "NOT_APPLICABLE"
    assert components["Point"]["measurement_value"] is None
    line = components["LineString"]
    assert line["measurement_status"] == "COMPLETED"
    assert line["measurement_type"] == "length"
    assert line["measurement_unit"] == "m"
    assert 50.0 < line["measurement_value"] < 200.0


def test_broken_outline_failed_safely(isolated_client):
    client, _ = isolated_client
    _, by_id = _upload_catalog(client)
    broken = by_id[6]
    assert broken["geometry"] is None
    assert broken["measurement"] is None
    assert broken["components"] is None
    assert broken["error_details"] == "Empty geometry."
