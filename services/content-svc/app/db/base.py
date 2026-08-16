"""Declarative base shared by all models."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    """Declarative base for all ORM models in the content schema."""

    type_annotation_map: dict[type, Any] = {}

    # `updated_at` uses a SQL-expression onupdate, so after an UPDATE SQLAlchemy
    # does not know the new value and expires the attribute. Reading it again
    # (e.g. Pydantic serialising the row into the response) triggers a lazy
    # refresh, which under asyncio raises
    #   MissingGreenlet: greenlet_spawn has not been called
    # turning every update endpoint into a 500.
    #
    # eager_defaults fetches server-generated values via RETURNING in the same
    # statement, so nothing is left expired.
    __mapper_args__ = {"eager_defaults": True}


class TimestampMixin:
    """Adds created_at + updated_at columns matching Phase 2 conventions."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
