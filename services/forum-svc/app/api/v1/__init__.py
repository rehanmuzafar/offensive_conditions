"""Aggregate v1 routes."""

from fastapi import APIRouter

from app.api.v1 import health, social, threads

api_router = APIRouter()
api_router.include_router(health.router)  # /livez, /readyz

v1 = APIRouter(prefix="/v1")
v1.include_router(threads.router)
v1.include_router(social.router)
api_router.include_router(v1)
