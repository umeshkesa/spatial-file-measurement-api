"""Feature record model."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeatureRecord(Base):
    __tablename__ = "features"
    __table_args__ = (
        UniqueConstraint("file_id", "feature_index", name="uq_features_file_index"),
        Index("ix_features_file_id", "file_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    feature_index: Mapped[int] = mapped_column(nullable=False)
    geometry_type: Mapped[str] = mapped_column(String(64), nullable=False)
    geometry_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    properties_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    measurement_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    measurement_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    measurement_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    measurement_status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON list of per-component results for GeometryCollection features
    # (see measurement_service.measure_collection); null otherwise.
    components_json: Mapped[str | None] = mapped_column(Text, nullable=True)
