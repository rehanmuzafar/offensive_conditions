"""Featured lists: what the marketing surfaces show, chosen in the admin panel.

Public GET is anonymous (the marketing pages read it server-side). PUT replaces
the whole ordered list for one surface and is staff-only. Surfaces are a closed
set so a typo cannot create an orphaned list nothing ever reads.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.models.featured import Featured

router = APIRouter(prefix="/content/featured", tags=["featured"])

# machine ids for the two machine surfaces, CTF event ids for the CTF surface.
VALID_SURFACES = {"landing_machines", "labs_page", "ctf_page"}


class FeaturedItem(BaseModel):
    item_type: str
    item_id: str
    rank: int


class FeaturedList(BaseModel):
    surface: str
    items: list[FeaturedItem]


class SetFeatured(BaseModel):
    item_type: str
    items: list[str]  # ordered item ids


def _check_surface(surface: str) -> None:
    if surface not in VALID_SURFACES:
        raise AppError(ErrorCode.VALIDATION, f"unknown surface: {surface}")


@router.get("", response_model=FeaturedList)
async def get_featured(
    surface: str = Query(...),
    db: AsyncSession = Depends(get_session),
) -> FeaturedList:
    _check_surface(surface)
    rows = (
        await db.execute(
            select(Featured).where(Featured.surface == surface).order_by(Featured.rank)
        )
    ).scalars().all()
    return FeaturedList(
        surface=surface,
        items=[
            FeaturedItem(item_type=r.item_type, item_id=str(r.item_id), rank=r.rank)
            for r in rows
        ],
    )


@router.put("", response_model=FeaturedList)
async def set_featured(
    body: SetFeatured,
    surface: str = Query(...),
    claims: Claims = Depends(get_claims),
    db: AsyncSession = Depends(get_session),
) -> FeaturedList:
    if not claims.is_staff:
        raise AppError(ErrorCode.FORBIDDEN, "staff role required")
    _check_surface(surface)

    # Replace the whole list for this surface. The session commits on the way out.
    await db.execute(delete(Featured).where(Featured.surface == surface))

    items: list[FeaturedItem] = []
    seen: set[str] = set()
    rank = 0
    for raw in body.items:
        if raw in seen:
            continue
        try:
            parsed = UUID(str(raw))
        except (ValueError, AttributeError, TypeError):
            continue  # skip anything that is not a real id rather than 500
        seen.add(raw)
        db.add(
            Featured(surface=surface, item_type=body.item_type, item_id=parsed, rank=rank)
        )
        items.append(FeaturedItem(item_type=body.item_type, item_id=str(parsed), rank=rank))
        rank += 1

    return FeaturedList(surface=surface, items=items)
