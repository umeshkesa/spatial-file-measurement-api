"""API routes for files and measurements."""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.dependencies import get_app_settings, get_db_session
from app.core.config import Settings
from app.core.exceptions import (
    AppError,
    InvalidFileError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaError,
)
from app.core.logging import get_logger
from app.models.feature_record import FeatureRecord
from app.repositories import feature_repository, file_repository
from app.schemas.files import FileInfoResponse, FileUploadResponse
from app.schemas.measurements import (
    FeatureMeasurement,
    MeasurementDetail,
    MeasurementsResponse,
)
from app.services import file_service
from app.services.geospatial_reader import validate_extension

log = get_logger(__name__)

router = APIRouter(prefix="/api/files", tags=["files"])


async def _read_upload_limited(upload: UploadFile, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise PayloadTooLargeError(f"Upload exceeds the configured limit of {limit} bytes.")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/", response_model=FileUploadResponse, status_code=201)
async def upload_file(
    file: UploadFile,
    session: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> FileUploadResponse:
    filename = file.filename or ""
    if not filename:
        raise InvalidFileError("No filename was provided.")
    try:
        validate_extension(filename)
    except InvalidFileError as exc:
        raise UnsupportedMediaError(str(exc)) from exc
    content = await _read_upload_limited(file, settings.max_upload_bytes)
    if not content:
        raise InvalidFileError("Uploaded file is empty.")
    file_id, storage_path = file_service.save_upload_bytes(content, filename, settings)
    log.info("Upload %s (%s, %d bytes)", file_id, filename, len(content))
    try:
        record = file_service.process_upload(
            session,
            settings,
            file_id=file_id,
            original_filename=Path(filename).name,
            storage_path=storage_path,
        )
    except AppError:
        raise
    except Exception as exc:
        log.exception("Unexpected processing failure for %s", file_id)
        raise AppError(
            "INTERNAL_ERROR", "Unexpected failure while processing the file.", 500
        ) from exc
    return FileUploadResponse(
        id=record.id,
        filename=record.original_filename,
        feature_count=record.feature_count,
        crs=record.source_crs,
        status=record.status,
        created_at=record.created_at,
    )


def _file_or_404(session: Session, file_id: str):
    record = file_repository.get(session, file_id)
    if record is None:
        raise NotFoundError(f"File '{file_id}' was not found.")
    return record


@router.get("/{file_id}/", response_model=FileInfoResponse)
def get_file_info(
    file_id: str,
    session: Session = Depends(get_db_session),
) -> FileInfoResponse:
    record = _file_or_404(session, file_id)
    return FileInfoResponse(
        id=record.id,
        filename=record.original_filename,
        feature_count=record.feature_count,
        crs=record.source_crs,
        measurement_crs=record.measurement_crs,
        status=record.status,
        created_at=record.created_at,
        error_summary=record.error_summary,
    )


def _feature_to_schema(row: FeatureRecord) -> FeatureMeasurement:
    try:
        geometry = json.loads(row.geometry_json) if row.geometry_json else None
    except Exception:
        geometry = None
    try:
        properties = json.loads(row.properties_json) if row.properties_json else {}
    except Exception:
        properties = {}
    if not isinstance(properties, dict):
        properties = {"value": properties}
    measurement = None
    if row.measurement_type and row.measurement_status == "COMPLETED":
        measurement = MeasurementDetail(
            type=row.measurement_type,
            value=row.measurement_value,
            unit=row.measurement_unit or "",
            status=row.measurement_status,
        )
    elif row.measurement_type and row.measurement_value is not None:
        measurement = MeasurementDetail(
            type=row.measurement_type,
            value=row.measurement_value,
            unit=row.measurement_unit or "",
            status=row.measurement_status,
        )
    return FeatureMeasurement(
        feature_id=row.feature_index,
        geometry_type=row.geometry_type,
        geometry=geometry,
        properties=properties,
        measurement=measurement,
        measurement_status=row.measurement_status,
        error_details=row.error_details,
    )


@router.get("/{file_id}/measurements/", response_model=MeasurementsResponse)
def get_measurements(
    file_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> MeasurementsResponse:
    record = _file_or_404(session, file_id)
    rows, total = feature_repository.list_for_file(session, file_id, limit=limit, offset=offset)
    features = [_feature_to_schema(r) for r in rows]
    return MeasurementsResponse(
        file_id=record.id,
        source_crs=record.source_crs,
        measurement_crs=record.measurement_crs,
        units={"area": "m²", "length": "m"},
        total=total,
        limit=limit,
        offset=offset,
        count=len(features),
        has_more=(offset + len(features)) < total,
        features=features,
    )


@router.delete("/{file_id}/", status_code=200)
def delete_file(
    file_id: str,
    session: Session = Depends(get_db_session),
) -> dict:
    record = _file_or_404(session, file_id)
    storage_path = record.storage_key
    feature_repository.delete_for_file(session, file_id)
    file_repository.delete(session, record)
    session.commit()
    try:
        if storage_path and os.path.exists(storage_path):
            os.remove(storage_path)
    except Exception as exc:
        log.warning("Could not remove stored file %s: %s", storage_path, exc)
    return {"id": file_id, "deleted": True}
