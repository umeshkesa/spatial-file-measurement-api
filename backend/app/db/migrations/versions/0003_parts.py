"""Add parts_json to features for multi-geometry part breakdowns.

Revision ID: 0003_parts
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_parts"
down_revision = "0002_components"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("features", sa.Column("parts_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("features", "parts_json")
