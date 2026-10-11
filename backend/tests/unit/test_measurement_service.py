"""Unit tests for the measurement service."""

from __future__ import annotations

from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Point,
    Polygon,
)

from app.services.measurement_service import measure_collection, measure_parts, measure_projected


def test_square_area_100x100():
    poly = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
    res = measure_projected(poly, "Polygon")
    assert res.status == "COMPLETED"
    assert res.measurement_type == "area"
    assert res.unit == "m²"
    assert res.value == pytest_approx(10000.0)


def pytest_approx(expected: float, tol: float = 1e-6):
    return _Approx(expected, tol)


class _Approx:
    def __init__(self, expected: float, tol: float) -> None:
        self.expected = expected
        self.tol = tol

    def __eq__(self, other: object) -> bool:
        return isinstance(other, (int, float)) and abs(float(other) - self.expected) <= self.tol


def test_linestring_length():
    line = LineString([(0, 0), (0, 150)])
    res = measure_projected(line, "LineString")
    assert res.status == "COMPLETED"
    assert res.measurement_type == "length"
    assert res.unit == "m"
    assert abs(res.value - 150.0) < 1e-6


def test_point_not_applicable():
    res = measure_projected(Point(1, 2), "Point")
    assert res.status == "NOT_APPLICABLE"
    assert res.value is None


def test_multipoint_not_applicable():
    res = measure_projected(MultiPoint([(0, 0), (1, 1)]), "MultiPoint")
    assert res.status == "NOT_APPLICABLE"


def test_multipolygon_sums_parts():
    p1 = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    p2 = Polygon([(20, 20), (30, 20), (30, 30), (20, 30)])
    res = measure_projected(MultiPolygon([p1, p2]), "MultiPolygon")
    assert res.status == "COMPLETED"
    assert abs(res.value - 200.0) < 1e-6


def test_multilinestring_sums_parts():
    ml = MultiLineString([[(0, 0), (0, 10)], [(0, 0), (30, 0)]])
    res = measure_projected(ml, "MultiLineString")
    assert res.status == "COMPLETED"
    assert abs(res.value - 40.0) < 1e-6


def test_polygon_with_hole_subtracts_inner():
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    hole = [(2, 2), (4, 2), (4, 4), (2, 4)]
    poly = Polygon(outer, [hole])
    res = measure_projected(poly, "Polygon")
    assert res.status == "COMPLETED"
    assert abs(res.value - 96.0) < 1e-6


def test_empty_geometry_fails_safely():
    res = measure_projected(Polygon(), "Polygon")
    assert res.status == "FAILED"
    assert res.value is None


def test_none_geometry_fails_safely():
    res = measure_projected(None, "Polygon")
    assert res.status == "FAILED"


def test_unsupported_geometry_collection():
    gc = GeometryCollection([Point(0, 0)])
    res = measure_projected(gc, "GeometryCollection")
    assert res.status == "UNSUPPORTED"


def test_invalid_polygon_repaired():
    # Bowtie (self-intersecting) polygon is invalid; make_valid should repair it.
    bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2)])
    assert not bowtie.is_valid
    res = measure_projected(bowtie, "Polygon")
    assert res.status == "COMPLETED"
    assert res.repaired is True
    assert res.value is not None and res.value > 0


def test_collection_mixed_point_and_line_is_partial():
    gc = GeometryCollection([Point(0, 0), LineString([(0, 0), (0, 40)])])
    overall, components = measure_collection(gc, "GeometryCollection")
    assert overall.status == "PARTIAL"
    assert overall.value is None  # no single invented measurement
    assert len(components) == 2
    by_type = {c.geometry_type: c for c in components}
    assert by_type["Point"].status == "NOT_APPLICABLE"
    assert by_type["LineString"].status == "COMPLETED"
    assert by_type["LineString"].measurement_type == "length"
    assert abs(by_type["LineString"].value - 40.0) < 1e-6


def test_collection_all_points_not_applicable():
    gc = GeometryCollection([Point(0, 0), Point(1, 1)])
    overall, components = measure_collection(gc, "GeometryCollection")
    assert overall.status == "NOT_APPLICABLE"
    assert all(c.status == "NOT_APPLICABLE" for c in components)


def test_collection_polygons_measure_each_part():
    p1 = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    p2 = Polygon([(20, 20), (25, 20), (25, 25), (20, 25)])
    overall, components = measure_collection(GeometryCollection([p1, p2]), "GeometryCollection")
    assert overall.status == "PARTIAL"
    assert [c.value for c in components] == [100.0, 25.0]
    assert all(c.measurement_type == "area" for c in components)


def test_collection_empty_is_failed_not_partial():
    overall, components = measure_collection(GeometryCollection(), "GeometryCollection")
    assert overall.status == "FAILED"
    assert components == []
    overall, _ = measure_collection(None, "GeometryCollection")
    assert overall.status == "FAILED"


def test_collection_with_unsupported_member_reports_it():
    gc = GeometryCollection([Point(0, 0), GeometryCollection([Point(1, 1)])])
    overall, components = measure_collection(gc, "GeometryCollection")
    assert overall.status == "UNSUPPORTED"
    assert components[1].status == "UNSUPPORTED"
    assert components[1].error is not None


def test_parts_multipolygon_measured_independently():
    p1 = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    p2 = Polygon([(20, 20), (25, 20), (25, 25), (20, 25)])
    mp = MultiPolygon([p1, p2])
    parts = measure_parts(mp, "MultiPolygon")
    assert parts is not None and len(parts) == 2
    assert [p.part_index for p in parts] == [0, 1]
    assert [p.geometry_type for p in parts] == ["Polygon", "Polygon"]
    assert [p.value for p in parts] == [100.0, 25.0]
    assert all(p.measurement_type == "area" and p.unit == "m²" for p in parts)
    assert all(p.status == "COMPLETED" for p in parts)
    # Sum of valid parts equals the combined whole within float tolerance.
    whole = measure_projected(mp, "MultiPolygon")
    assert abs(sum(p.value for p in parts) - whole.value) < 1e-9 * whole.value


def test_parts_multilinestring_measured_independently():
    ml = MultiLineString([[(0, 0), (0, 10)], [(0, 0), (30, 0)]])
    parts = measure_parts(ml, "MultiLineString")
    assert parts is not None and len(parts) == 2
    assert [p.value for p in parts] == [10.0, 30.0]
    assert all(p.measurement_type == "length" and p.unit == "m" for p in parts)
    whole = measure_projected(ml, "MultiLineString")
    assert abs(sum(p.value for p in parts) - whole.value) < 1e-9 * whole.value


def test_parts_single_geometries_need_no_breakdown():
    assert measure_parts(Polygon([(0, 0), (1, 0), (1, 1)]), "Polygon") is None
    assert measure_parts(LineString([(0, 0), (1, 1)]), "LineString") is None
    assert measure_parts(Point(0, 0), "Point") is None
    assert measure_parts(MultiPoint([(0, 0), (1, 1)]), "MultiPoint") is None
    assert measure_parts(None, "MultiPolygon") is None


def test_parts_empty_multi_has_no_members():
    assert measure_parts(MultiPolygon(), "MultiPolygon") == []
    assert measure_parts(MultiLineString(), "MultiLineString") == []
