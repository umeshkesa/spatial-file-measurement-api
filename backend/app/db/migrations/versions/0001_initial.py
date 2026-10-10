"""Initial schema: files + features tables.

Revision ID: 0001_initial
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("storage_key", sa.String(1024), nullable=False),
        sa.Column("source_crs", sa.String(64), nullable=True),
        sa.Column("measurement_crs", sa.String(64), nullable=True),
        sa.Column("feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="PROCESSING"),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "features",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "file_id",
            sa.String(64),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feature_index", sa.Integer(), nullable=False),
        sa.Column("geometry_type", sa.String(64), nullable=False),
        sa.Column("geometry_json", sa.Text(), nullable=True),
        sa.Column("properties_json", sa.Text(), nullable=True),
        sa.Column("measurement_type", sa.String(32), nullable=True),
        sa.Column("measurement_value", sa.Float(), nullable=True),
        sa.Column("measurement_unit", sa.String(16), nullable=True),
        sa.Column("measurement_status", sa.String(32), nullable=False),
        sa.Column("error_details", sa.Text(), nullable=True),
        sa.UniqueConstraint("file_id", "feature_index", name="uq_features_file_index"),
    )
    op.create_index("ix_features_file_id", "features", ["file_id"])


def downgrade() -> None:
    op.drop_index("ix_features_file_id", table_name="features")
    op.drop_table("features")
    op.drop_table("files")
