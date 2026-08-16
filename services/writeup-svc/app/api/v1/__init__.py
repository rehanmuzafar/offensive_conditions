"""Aggregate v1 routes."""

from fastapi import APIRouter

from app.api.v1 import comments, health, writeups

api_router = APIRouter()
api_router.include_router(health.router)

v1 = APIRouter(prefix="/v1")
v1.include_router(writeups.router)
v1.include_router(comments.router)
api_router.include_router(v1)
