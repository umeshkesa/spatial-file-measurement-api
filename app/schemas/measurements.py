"""Pydantic schemas for measurement endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MeasurementDetail(BaseModel):
    type: str
    value: float | None
    unit: str
    status: str


class FeatureMeasurement(BaseModel):
    feature_id: int
    geometry_type: str
    geometry: dict[str, Any] | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
    measurement: MeasurementDetail | None = None
    measurement_status: str
    error_details: str | None = None


class MeasurementsResponse(BaseModel):
    file_id: str
    source_crs: str | None
    measurement_crs: str | None
    units: dict[str, str] = Field(default_factory=lambda: {"area": "m²", "length": "m"})
    total: int
    limit: int
    offset: int
    count: int
    has_more: bool
    features: list[FeatureMeasurement]
