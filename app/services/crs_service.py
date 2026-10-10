"""CRS selection and transformation service.

Policy:
- If the source CRS is projected with metre units, measure in the source CRS.
- If the source CRS is geographic (degrees), pick a projected CRS:
  - Local datasets (small extent within UTM limits) -> estimated UTM zone.
  - Large / multi-zone / polar extents -> global equal-area EPSG:6933 fallback.
- Never compute planar area/length directly in degrees.
"""

from __future__ import annotations

import math

import geopandas as gpd
from pyproj import CRS
from shapely.geometry.base import BaseGeometry

from app.core.exceptions import InvalidGeodataError

_FALLBACK_EQUAL_AREA = "EPSG:6933"


def parse_crs(crs_value: object) -> CRS | None:
    """Parse anything geopandas may report as CRS; return None if unknown."""
    if crs_value is None:
        return None
    try:
        return CRS.from_user_input(crs_value)
    except Exception:
        return None


def crs_to_string(crs: CRS | None) -> str | None:
    if crs is None:
        return None
    try:
        auth = crs.to_authority()
        if auth and auth[0] and auth[1]:
            return f"{auth[0]}:{auth[1]}"
    except Exception:
        pass
    try:
        return crs.to_string()
    except Exception:
        return None


def is_geographic(crs: CRS) -> bool:
    try:
        return bool(crs.is_geographic)
    except Exception:
        return False


def is_projected_metre(crs: CRS) -> bool:
    try:
        if not crs.is_projected:
            return False
        unit = (crs.axis_info[0].unit_name or "").lower() if crs.axis_info else ""
        return "metre" in unit or "meter" in unit or unit == "m"
    except Exception:
        return False


def estimate_utm_epsg(lon: float, lat: float) -> str:
    """Estimate the UTM EPSG code for a lon/lat point."""
    zone = int(math.floor((lon + 180.0) / 6.0)) + 1
    zone = max(1, min(60, zone))
    if lat >= 0:
        return f"EPSG:{32600 + zone}"
    return f"EPSG:{32700 + zone}"


def select_measurement_crs(source_crs: CRS, gdf: gpd.GeoDataFrame) -> str:
    """Select a projected measurement CRS for the dataset.

    Raises InvalidGeodataError when no usable CRS can be determined.
    """
    if source_crs is None:
        raise InvalidGeodataError("Cannot select a measurement CRS without a source CRS.")
    if is_projected_metre(source_crs):
        code = crs_to_string(source_crs)
        if code is None:
            raise InvalidGeodataError("Source CRS is not usable for measurements.")
        return code
    if not is_geographic(source_crs):
        raise InvalidGeodataError(
            "Source CRS is neither a recognised geographic nor a metre-based projected CRS."
        )
    # Geographic -> need projected CRS. Use dataset extent in lon/lat.
    try:
        bounds = gdf.geometry.total_bounds  # minx, miny, maxx, maxy
    except Exception as exc:
        raise InvalidGeodataError(f"Cannot determine dataset extent: {exc}") from exc
    minx, miny, maxx, maxy = (float(v) for v in bounds)
    if any(math.isnan(v) or math.isinf(v) for v in (minx, miny, maxx, maxy)):
        raise InvalidGeodataError("Dataset extent is not finite; cannot select measurement CRS.")
    width = abs(maxx - minx)
    height = abs(maxy - miny)
    # Antimeridian crossing produces huge width; treat as non-local.
    crosses_antimeridian = width > 180.0
    # UTM is valid to 84N but only to 80S (polar regions use UPS instead).
    outside_utm_latitude = maxy > 84.0 or miny < -80.0
    non_local = crosses_antimeridian or outside_utm_latitude or width > 6.0 or height > 8.0
    if non_local:
        # Large / multi-zone / polar dataset: equal-area global projection.
        return _FALLBACK_EQUAL_AREA
    clon = (minx + maxx) / 2.0
    clat = (miny + maxy) / 2.0
    # Clamp into valid lon/lat just in case.
    clon = max(-179.999, min(179.999, clon))
    clat = max(-83.999, min(83.999, clat))
    return estimate_utm_epsg(clon, clat)


def transform_geometry(geom: BaseGeometry, source_crs: CRS, measurement_crs: str):
    """Transform a single shapely geometry from source to measurement CRS."""
    import geopandas as _gpd

    gs = _gpd.GeoSeries([geom], crs=source_crs)
    projected = gs.to_crs(measurement_crs)
    return projected.iloc[0]
