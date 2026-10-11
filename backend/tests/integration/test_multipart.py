"""Multipart breakdown tests using the real sample_data/multipart_shapes.zip.

Verifies per-part measurements for Twin Lakes (MultiPolygon) and Ring Road
(MultiLineString): independent values, aggregation consistency with the
combined feature result, and untouched point handling.
"""

from __future__ import annotations

from pathlib import Path

FIXTURE = (
    Path(__file__).resolve().parent.parent.parent.parent / "sample_data" / "multipart_shapes.zip"
)


def _upload_multipart(client):
    assert FIXTURE.exists(), f"missing fixture: {FIXTURE}"
    r = client.post("/api/files/", files={"file": ("multipart_shapes.zip", FIXTURE.read_bytes())})
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    body = client.get(f"/api/files/{fid}/measurements/?limit=100&offset=0").json()
    assert body["total"] == 3, body
    return {f["feature_id"]: f for f in body["features"]}


def _by_name(by_id, name):
    for f in by_id.values():
        props = f.get("properties") or {}
        if props.get("name") == name:
            return f
    raise AssertionError(f"feature {name!r} not found")


def test_twin_lakes_parts_sum_to_combined_area(isolated_client):
    client, _ = isolated_client
    by_id = _upload_multipart(client)
    lakes = _by_name(by_id, "Twin Lakes")
    assert lakes["geometry_type"] == "MultiPolygon"
    assert lakes["measurement"]["type"] == "area"
    whole = lakes["measurement"]["value"]
    assert 20000.0 < whole < 24000.0  # combined result unchanged

    parts = lakes["parts"]
    assert parts is not None and len(parts) == 2
    assert [p["part_index"] for p in parts] == [0, 1]
    assert all(p["geometry_type"] == "Polygon" for p in parts)
    assert all(p["measurement_status"] == "COMPLETED" for p in parts)
    assert all(p["measurement_type"] == "area" and p["measurement_unit"] == "m²" for p in parts)
    values = [p["measurement_value"] for p in parts]
    assert all(9000.0 < v < 13000.0 for v in values)  # independent, not halved blindly
    assert abs(sum(values) - whole) <= 1e-9 * whole


def test_ring_road_parts_sum_to_combined_length(isolated_client):
    client, _ = isolated_client
    by_id = _upload_multipart(client)
    road = _by_name(by_id, "Ring Road")
    assert road["geometry_type"] == "MultiLineString"
    whole = road["measurement"]["value"]
    parts = road["parts"]
    assert parts is not None and len(parts) == 2
    assert all(p["measurement_type"] == "length" for p in parts)
    assert abs(sum(p["measurement_value"] for p in parts) - whole) <= 1e-9 * whole


def test_points_have_no_part_breakdown(isolated_client):
    client, _ = isolated_client
    by_id = _upload_multipart(client)
    pegs = _by_name(by_id, "Survey Pegs")
    assert pegs["geometry_type"] == "MultiPoint"
    assert pegs["measurement_status"] == "NOT_APPLICABLE"
    assert pegs["parts"] is None
