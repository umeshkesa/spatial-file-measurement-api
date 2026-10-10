"""File record repository."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.file_record import FileRecord


def get(session: Session, file_id: str) -> FileRecord | None:
    return session.get(FileRecord, file_id)


def create(session: Session, record: FileRecord) -> FileRecord:
    session.add(record)
    session.flush()
    return record


def update_status(
    session: Session,
    record: FileRecord,
    *,
    status: str,
    feature_count: int | None = None,
    source_crs: str | None = None,
    measurement_crs: str | None = None,
    error_summary: str | None = None,
) -> FileRecord:
    record.status = status
    if feature_count is not None:
        record.feature_count = feature_count
    if source_crs is not None:
        record.source_crs = source_crs
    if measurement_crs is not None:
        record.measurement_crs = measurement_crs
    if error_summary is not None:
        record.error_summary = error_summary
    session.flush()
    return record


def delete(session: Session, record: FileRecord) -> None:
    session.delete(record)
    session.flush()
