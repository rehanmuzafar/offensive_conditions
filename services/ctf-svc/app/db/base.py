"""Declarative base."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    type_annotation_map: dict[type, Any] = {}

    # `updated_at` below uses a SQL-expression onupdate, so after an UPDATE
    # SQLAlchemy does not know the new value and expires the attribute. Reading
    # it again (e.g. Pydantic serialising the row in the response) then triggers
    # a lazy refresh — which under asyncio raises
    #   MissingGreenlet: greenlet_spawn has not been called
    # and turns every update endpoint into a 500.
    #
    # eager_defaults makes SQLAlchemy fetch server-generated values with
    # RETURNING as part of the same statement, so nothing is left expired.
    __mapper_args__ = {"eager_defaults": True}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
