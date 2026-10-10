"""Unit tests for CRS selection and transformation."""

from __future__ import annotations

import geopandas as gpd
from pyproj import CRS
from shapely.geometry import Point

from app.services import crs_service


def _gdf_around(lon: float, lat: float, size: float = 0.001) -> gpd.GeoDataFrame:
    from shapely.geometry import Polygon

    poly = Polygon(
        [
            (lon, lat),
            (lon + size, lat),
            (lon + size, lat + size),
            (lon, lat + size),
        ]
    )
    return gpd.GeoDataFrame({"a": [1]}, geometry=[poly], crs="EPSG:4326")


def test_estimate_utm_delhi():
    # Delhi lon ~77 -> zone 43N -> EPSG:32643.
    assert crs_service.estimate_utm_epsg(77.0, 28.0) == "EPSG:32643"


def test_estimate_utm_southern_hemisphere():
    assert crs_service.estimate_utm_epsg(151.0, -33.0) == "EPSG:32756"


def test_projected_metre_crs_used_directly():
    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[Point(500000, 3000000)], crs="EPSG:32643")
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:32643"), gdf)
    assert out == "EPSG:32643"


def test_geographic_local_selects_utm():
    gdf = _gdf_around(77.0, 28.0)
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:32643"


def test_large_extent_falls_back_to_equal_area():
    from shapely.geometry import box

    # Continent-scale dataset spanning many UTM zones.
    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[box(-120, -40, 120, 60)], crs="EPSG:4326")
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:6933"


def test_antimeridian_dataset_uses_fallback():
    from shapely.geometry import box

    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[box(170, 10, -170 + 360, 12)], crs="EPSG:4326")
    # box(170,10,190,12) has width 20 -> non-local -> fallback
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:6933"


def test_transformation_proves_not_degree_based():
    """Projected coordinates must differ hugely from raw degrees."""
    from shapely.geometry import Polygon

    poly = Polygon([(77.0, 28.0), (77.001, 28.0), (77.001, 28.001), (77.0, 28.001)])
    projected = crs_service.transform_geometry(poly, CRS.from_user_input("EPSG:4326"), "EPSG:32643")
    assert abs(projected.area) > 1000.0  # square metres, not ~1e-6 square degrees
    assert abs(poly.area) < 1e-5  # raw degree area is tiny/meaningless
