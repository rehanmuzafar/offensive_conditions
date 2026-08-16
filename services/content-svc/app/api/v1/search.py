"""Search, tags, and categories endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_optional_claims, get_search_service
from app.core.auth import Claims
from app.db.session import get_session
from app.models import Category, Tag
from app.schemas import (
    CategoryRead,
    SearchResponse,
    TagRead,
)
from app.services.search import SearchService

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=2, max_length=200),
    type: str = Query("all", pattern="^(machine|challenge|path|all)$"),
    difficulty: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    claims: Claims | None = Depends(get_optional_claims),
    svc: SearchService = Depends(get_search_service),
) -> SearchResponse:
    viewer_tier = claims.tier if claims else "free"
    hits, facets = await svc.search(
        query=q, type_=type, viewer_tier=viewer_tier, difficulty=difficulty, limit=limit
    )
    return SearchResponse(query=q, total=len(hits), hits=hits, facets=facets)


@router.get("/tags", response_model=list[TagRead])
async def list_tags(
    session: AsyncSession = Depends(get_session),
) -> list[TagRead]:
    result = await session.execute(select(Tag).order_by(Tag.name.asc()))
    return [TagRead.model_validate(t) for t in result.scalars().all()]


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    session: AsyncSession = Depends(get_session),
) -> list[CategoryRead]:
    result = await session.execute(
        select(Category).order_by(Category.sort_order.asc(), Category.name.asc())
    )
    return [CategoryRead.model_validate(c) for c in result.scalars().all()]
