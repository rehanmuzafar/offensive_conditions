"""Health probes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session

router = APIRouter(tags=["health"])


@router.get("/livez")
async def livez(request: Request) -> dict:
    version = getattr(request.app.state, "version", "unknown")
    return {"status": "ok", "version": version}


@router.get("/readyz")
async def readyz(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict:
    checks: dict[str, str] = {}
    overall = True
    try:
        await session.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"down: {e}"
        overall = False
    redis = getattr(request.app.state, "redis", None)
    if redis:
        try:
            await redis.ping()
            checks["redis"] = "ok"
        except Exception as e:
            checks["redis"] = f"down: {e}"
            overall = False
    if not overall:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ok": overall, "checks": checks}
