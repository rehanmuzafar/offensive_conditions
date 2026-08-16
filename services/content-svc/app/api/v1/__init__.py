"""Aggregate all v1 routes."""

from fastapi import APIRouter

from app.api.v1 import media, challenges, health, machines, paths, search

api_router = APIRouter()
api_router.include_router(health.router)  # /livez, /readyz (no prefix)

v1 = APIRouter(prefix="/v1")
v1.include_router(machines.router)
v1.include_router(challenges.router)
v1.include_router(paths.router)
v1.include_router(search.router)
v1.include_router(media.router)
api_router.include_router(v1)
