"""Add components_json to features for GeometryCollection breakdowns.

Revision ID: 0002_components
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_components"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("features", sa.Column("components_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("features", "components_json")
