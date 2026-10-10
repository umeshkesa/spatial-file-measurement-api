"""Pydantic schemas for file endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FileUploadResponse(BaseModel):
    id: str
    filename: str
    feature_count: int
    crs: str | None
    status: str
    created_at: datetime


class FileInfoResponse(BaseModel):
    id: str
    filename: str
    feature_count: int
    source_crs: str | None = Field(default=None, alias="crs")
    measurement_crs: str | None = None
    status: str
    created_at: datetime
    error_summary: str | None = None

    model_config = {"populate_by_name": True}
