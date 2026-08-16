"""Alembic environment.

Phase 2 already creates the content schema. This env is used for any
content-svc-specific migrations layered on top (additional indexes, materialized
views, search vector triggers refinements, etc.).
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make `app` importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: E402,F401
    Category,
    Challenge,
    ChallengeTag,
    LearningPath,
    Machine,
    MachineHint,
    MachineRating,
    MachineTag,
    ModuleProgress,
    PathEnrollment,
    PathModule,
    Tag,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the database URL from settings (overrides empty alembic.ini value)
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_sync_url)

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):  # noqa: ARG001
    """Limit autogen to the content schema we own."""
    if type_ == "table":
        return object.schema == "content"
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        version_table_schema="content",
        include_schemas=True,
        include_object=include_object,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="content",
            include_schemas=True,
            include_object=include_object,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
