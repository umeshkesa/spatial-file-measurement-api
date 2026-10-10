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


def test_estimate_utm_hyderabad():
    # Hyderabad lon ~78.48 -> zone 44N -> EPSG:32644 (not 32643).
    assert crs_service.estimate_utm_epsg(78.48, 17.38) == "EPSG:32644"


def test_estimate_utm_zone_boundary_meridian():
    # UTM zone 43 spans 72E-78E, zone 44 spans 78E-84E; a point exactly on
    # the 78E meridian belongs to zone 44 by convention.
    assert crs_service.estimate_utm_epsg(78.0, 20.0) == "EPSG:32644"
    assert crs_service.estimate_utm_epsg(77.999, 20.0) == "EPSG:32643"
    assert crs_service.estimate_utm_epsg(78.001, 20.0) == "EPSG:32644"


def test_estimate_utm_dateline_edges():
    # Lon edges clamp into the valid 1-60 zone range.
    assert crs_service.estimate_utm_epsg(-180.0, 10.0) == "EPSG:32601"
    assert crs_service.estimate_utm_epsg(180.0, 10.0) == "EPSG:32660"
    assert crs_service.estimate_utm_epsg(151.2, -33.9) == "EPSG:32756"


def test_estimate_utm_equator_hemisphere_split():
    # Latitude >= 0 selects north (326xx), latitude < 0 selects south (327xx).
    assert crs_service.estimate_utm_epsg(77.0, 0.0) == "EPSG:32643"
    assert crs_service.estimate_utm_epsg(77.0, -0.001) == "EPSG:32743"


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


def test_sample_kml_extent_selects_zone_43():
    """Regression: the sample KML spans lon 77.0-77.002 (Delhi), so the
    correct measurement CRS is EPSG:32643 -- not EPSG:32644."""
    from shapely.geometry import box

    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[box(77.0, 28.0, 77.002, 28.001)], crs="EPSG:4326")
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:32643"


def test_hyderabad_dataset_selects_zone_44():
    """Regression: Hyderabad (~78.48E, ~17.38N) lies in UTM zone 44N."""
    gdf = _gdf_around(78.48, 17.38)
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:32644"


def test_datasets_either_side_of_zone_boundary():
    from shapely.geometry import box

    west = gpd.GeoDataFrame(
        {"a": [1]}, geometry=[box(77.99, 20.0, 77.999, 20.001)], crs="EPSG:4326"
    )
    east = gpd.GeoDataFrame(
        {"a": [1]}, geometry=[box(78.001, 20.0, 78.01, 20.001)], crs="EPSG:4326"
    )
    src = CRS.from_user_input("EPSG:4326")
    assert crs_service.select_measurement_crs(src, west) == "EPSG:32643"
    assert crs_service.select_measurement_crs(src, east) == "EPSG:32644"


def test_southern_hemisphere_dataset_selects_south_utm():
    gdf = _gdf_around(151.2, -33.9)
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:32756"


def test_beyond_north_utm_limit_uses_fallback():
    from shapely.geometry import box

    # UTM north is valid only to 84N; polar data must not get a UTM zone.
    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[box(0, 85.0, 0.5, 85.5)], crs="EPSG:4326")
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:6933"


def test_beyond_south_utm_limit_uses_fallback():
    from shapely.geometry import box

    # UTM south is valid only to 80S (UPS beyond); Antarctic data falls back.
    gdf = gpd.GeoDataFrame({"a": [1]}, geometry=[box(0, -82.5, 0.5, -82.0)], crs="EPSG:4326")
    out = crs_service.select_measurement_crs(CRS.from_user_input("EPSG:4326"), gdf)
    assert out == "EPSG:6933"


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
