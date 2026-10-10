"""Feature record repository."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.feature_record import FeatureRecord


def bulk_create(session: Session, records: list[FeatureRecord]) -> None:
    session.add_all(records)
    session.flush()


def list_for_file(
    session: Session, file_id: str, *, limit: int, offset: int
) -> tuple[list[FeatureRecord], int]:
    total = (
        session.scalar(
            select(func.count()).select_from(FeatureRecord).where(FeatureRecord.file_id == file_id)
        )
        or 0
    )
    rows = list(
        session.scalars(
            select(FeatureRecord)
            .where(FeatureRecord.file_id == file_id)
            .order_by(FeatureRecord.feature_index.asc())
            .limit(limit)
            .offset(offset)
        ).all()
    )
    return rows, int(total)


def delete_for_file(session: Session, file_id: str) -> None:
    for row in session.scalars(select(FeatureRecord).where(FeatureRecord.file_id == file_id)).all():
        session.delete(row)
    session.flush()
