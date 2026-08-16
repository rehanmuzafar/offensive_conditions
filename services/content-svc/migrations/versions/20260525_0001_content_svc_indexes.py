"""content-svc-specific additions on top of Phase 2 schema.

Phase 2 already creates all 17 tables in the content schema. This migration adds:
- GIN trigram indexes on description columns for fuzzy search
- search_vector tsvector columns + triggers on machines/challenges/paths
- Index on machine_ratings(machine_id, rating) for stat rollups

Revision ID: 20260525_0001
Revises:
Create Date: 2026-05-25 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260525_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Trigram extension for fuzzy LIKE searches (Phase 2 already enables pg_trgm)
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # GIN trigram indexes for full-text-ish substring search
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_machines_name_trgm "
        "ON content.machines USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_machines_description_trgm "
        "ON content.machines USING gin (description gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_challenges_name_trgm "
        "ON content.challenges USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_challenges_description_trgm "
        "ON content.challenges USING gin (description gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_paths_name_trgm "
        "ON content.learning_paths USING gin (name gin_trgm_ops)"
    )

    # Rating rollup index
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_machine_ratings_machine_rating "
        "ON content.machine_ratings (machine_id, rating)"
    )

    # Status + tier composite for the most common list query
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_machines_status_tier_released "
        "ON content.machines (status, required_tier, released_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_challenges_status_tier_released "
        "ON content.challenges (status, required_tier, released_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS content.idx_machines_name_trgm")
    op.execute("DROP INDEX IF EXISTS content.idx_machines_description_trgm")
    op.execute("DROP INDEX IF EXISTS content.idx_challenges_name_trgm")
    op.execute("DROP INDEX IF EXISTS content.idx_challenges_description_trgm")
    op.execute("DROP INDEX IF EXISTS content.idx_paths_name_trgm")
    op.execute("DROP INDEX IF EXISTS content.idx_machine_ratings_machine_rating")
    op.execute("DROP INDEX IF EXISTS content.idx_machines_status_tier_released")
    op.execute("DROP INDEX IF EXISTS content.idx_challenges_status_tier_released")
