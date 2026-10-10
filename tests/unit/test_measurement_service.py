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

from app.services.measurement_service import measure_projected


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
