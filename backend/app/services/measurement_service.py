"""Per-feature measurement service.

- Polygon / MultiPolygon -> area in m^2 (projected coordinates).
- LineString / MultiLineString -> length in m (projected coordinates).
- Point / MultiPoint -> null measurement, NOT_APPLICABLE.
- GeometryCollection -> per-component breakdown; overall PARTIAL when at least
  one component measured, else the dominant non-measurable status.
- Anything else / empty / invalid -> explicit UNSUPPORTED or FAILED status.

Geometries passed in must already be in the measurement (projected, metre) CRS.
Callers transform before invoking :func:`measure_projected`.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry

AREA_TYPES = {"Polygon", "MultiPolygon"}
LENGTH_TYPES = {"LineString", "MultiLineString"}
POINT_TYPES = {"Point", "MultiPoint"}


@dataclass
class MeasurementResult:
    measurement_type: str | None
    value: float | None
    unit: str | None
    status: str  # COMPLETED | NOT_APPLICABLE | UNSUPPORTED | FAILED | PARTIAL
    repaired: bool = False
    error: str | None = None


@dataclass
class ComponentResult:
    """One member of a GeometryCollection, measured on its own merits."""

    geometry_type: str
    measurement_type: str | None
    value: float | None
    unit: str | None
    status: str  # COMPLETED | NOT_APPLICABLE | UNSUPPORTED | FAILED
    repaired: bool = False
    error: str | None = None


@dataclass
class PartResult:
    """One member of a multi geometry, measured independently in the same CRS."""

    part_index: int  # 0-based position within the parent multi geometry
    geometry_type: str
    measurement_type: str | None
    value: float | None
    unit: str | None
    status: str  # COMPLETED | NOT_APPLICABLE | UNSUPPORTED | FAILED
    repaired: bool = False
    error: str | None = None


# Multi geometry types that receive an independent per-part breakdown.
# MultiPoint is deliberately excluded: point counts already describe it and
# points carry no area/length measurement.
MULTI_PART_TYPES = {"MultiPolygon", "MultiLineString"}


def measure_parts(geom: BaseGeometry | None, geometry_type: str) -> list[PartResult] | None:
    """Measure each member of an already-projected multi geometry independently.

    Returns None for single (non-multi) geometry types, which need no part
    breakdown. Returns an empty list when the multi geometry has no members.
    Each part is measured with :func:`measure_projected` on its own merits,
    so part values are never derived by dividing the combined total.
    Never raises.
    """
    if geom is None:
        return None
    base = geometry_type.split(" ")[0] if geometry_type else "Unknown"
    base = base.strip()
    if base not in MULTI_PART_TYPES:
        return None
    try:
        members = list(geom.geoms)
    except Exception:
        return []
    parts: list[PartResult] = []
    for i, member in enumerate(members):
        try:
            member_type = member.geom_type
        except Exception:
            member_type = "Unknown"
        try:
            res = measure_projected(member, member_type)
        except Exception as exc:  # never let one bad part abort the breakdown
            res = MeasurementResult(None, None, None, "FAILED", error=f"Part failed: {exc}")
        parts.append(
            PartResult(
                part_index=i,
                geometry_type=member_type,
                measurement_type=res.measurement_type,
                value=res.value,
                unit=res.unit,
                status=res.status,
                repaired=res.repaired,
                error=res.error,
            )
        )
    return parts


def _repair(geom: BaseGeometry) -> tuple[BaseGeometry, bool]:
    """Return a valid geometry, repairing with make_valid when needed."""
    try:
        if geom.is_valid:
            return geom, False
    except Exception:
        pass
    try:
        from shapely.validation import make_valid

        fixed = make_valid(geom)
        return fixed, True
    except Exception:
        try:
            fixed = geom.buffer(0)
            return fixed, True
        except Exception:
            return geom, False


def measure_projected(geom: BaseGeometry | None, geometry_type: str) -> MeasurementResult:
    """Measure an already-projected geometry. Never raises."""
    if geom is None:
        return MeasurementResult(None, None, None, "FAILED", error="Null geometry.")
    try:
        if geom.is_empty:
            return MeasurementResult(None, None, None, "FAILED", error="Empty geometry.")
    except Exception as exc:
        return MeasurementResult(None, None, None, "FAILED", error=f"Unreadable geometry: {exc}")

    base = geometry_type.split(" ")[0] if geometry_type else "Unknown"
    # Normalise e.g. "Polygon" stays; handle 3D variants like "Polygon Z".
    base = base.strip()

    if base in POINT_TYPES:
        return MeasurementResult(None, None, None, "NOT_APPLICABLE")
    if base in LENGTH_TYPES:
        try:
            repaired_geom, repaired = _repair(geom)
            value = float(repaired_geom.length)
            return MeasurementResult("length", value, "m", "COMPLETED", repaired=repaired)
        except Exception as exc:
            return MeasurementResult(
                "length", None, "m", "FAILED", error=f"Length calculation failed: {exc}"
            )
    if base in AREA_TYPES:
        try:
            repaired_geom, repaired = _repair(geom)
            value = float(repaired_geom.area)
            return MeasurementResult("area", value, "m²", "COMPLETED", repaired=repaired)
        except Exception as exc:
            return MeasurementResult(
                "area", None, "m²", "FAILED", error=f"Area calculation failed: {exc}"
            )
    return MeasurementResult(
        None, None, None, "UNSUPPORTED", error=f"Unsupported geometry type: {geometry_type}"
    )


def measure_collection(
    geom: BaseGeometry | None, geometry_type: str
) -> tuple[MeasurementResult, list[ComponentResult]]:
    """Measure each member of an already-projected GeometryCollection.

    Returns (overall, components). The collection as a whole has no single
    area/length, so the overall measurement is always null; its status is:
    - PARTIAL when at least one component measured (others may be
      NOT_APPLICABLE / UNSUPPORTED / FAILED and are reported per component);
    - NOT_APPLICABLE when every component is a point type;
    - FAILED when a component failed and none measured;
    - UNSUPPORTED otherwise. Never raises.
    """
    if geom is None:
        overall = MeasurementResult(None, None, None, "FAILED", error="Null geometry.")
        return overall, []
    try:
        if geom.is_empty:
            overall = MeasurementResult(None, None, None, "FAILED", error="Empty geometry.")
            return overall, []
    except Exception as exc:
        overall = MeasurementResult(None, None, None, "FAILED", error=f"Unreadable geometry: {exc}")
        return overall, []
    try:
        members = list(geom.geoms)
    except Exception as exc:
        overall = MeasurementResult(
            None, None, None, "FAILED", error=f"Cannot enumerate collection members: {exc}"
        )
        return overall, []
    if not members:
        overall = MeasurementResult(None, None, None, "FAILED", error="Empty geometry.")
        return overall, []

    components: list[ComponentResult] = []
    for member in members:
        try:
            member_type = member.geom_type
        except Exception:
            member_type = "Unknown"
        res = measure_projected(member, member_type)
        components.append(
            ComponentResult(
                geometry_type=member_type,
                measurement_type=res.measurement_type,
                value=res.value,
                unit=res.unit,
                status=res.status,
                repaired=res.repaired,
                error=res.error,
            )
        )

    statuses = {c.status for c in components}
    repaired = any(c.repaired for c in components)
    if "COMPLETED" in statuses:
        # Not an error: the breakdown lives in `components`, so error stays null.
        overall = MeasurementResult(None, None, None, "PARTIAL", repaired=repaired)
    elif statuses == {"NOT_APPLICABLE"}:
        overall = MeasurementResult(None, None, None, "NOT_APPLICABLE", repaired=repaired)
    elif "FAILED" in statuses:
        overall = MeasurementResult(
            None,
            None,
            None,
            "FAILED",
            repaired=repaired,
            error="No component could be measured; see components.",
        )
    else:
        overall = MeasurementResult(
            None,
            None,
            None,
            "UNSUPPORTED",
            repaired=repaired,
            error=f"Unsupported geometry type: {geometry_type}",
        )
    return overall, components
