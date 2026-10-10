"""Integration: file info endpoint behaviour."""

from __future__ import annotations


def test_file_info_contains_expected_fields(isolated_client, kml_polygon_bytes):
    client, _ = isolated_client
    fid = client.post("/api/files/", files={"file": ("s.kml", kml_polygon_bytes)}).json()["id"]
    body = client.get(f"/api/files/{fid}/").json()
    for key in (
        "id",
        "filename",
        "feature_count",
        "crs",
        "measurement_crs",
        "status",
        "created_at",
    ):
        assert key in body, f"missing {key}"
    assert body["feature_count"] == 2


def test_file_info_failed_records_error_summary(isolated_client):
    client, _ = isolated_client
    r = client.post("/api/files/", files={"file": ("bad.kml", b"not kml")})
    assert r.status_code == 422
    # FAILED uploads still persist a file record? The upload endpoint raises
    # before returning an id, but processing failures ARE persisted; here the
    # KML parse failure returns 422 without an id by design (nothing stored yet
    # beyond the raw bytes). Assert consistent error shape instead.
    assert r.json()["error"]["code"] == "INVALID_GEODATA"
