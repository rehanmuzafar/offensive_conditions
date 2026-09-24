"""Admin-curated featured lists for the public marketing surfaces.

One row per (surface, item). The item_id is stored opaque — a machine id for the
labs/landing surfaces, a CTF event id for the CTF surface — because the admin UI
is what guarantees only a real item is ever selected, and this table has no need
to join across services to store a choice. An empty surface means the page shows
everything, so curation never has to be complete to be safe.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class Featured(Base):
    __tablename__ = "featured"
    __table_args__ = (UniqueConstraint("surface", "item_id"), {"schema": "content"})

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    surface: Mapped[str] = mapped_column(String, nullable=False)
    item_type: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
