"""Aggregate v1 routes."""

from fastapi import APIRouter

from app.api.v1 import health, programs, reports

api_router = APIRouter()
api_router.include_router(health.router)

v1 = APIRouter(prefix="/v1")
v1.include_router(programs.router)
v1.include_router(programs.admin_router)
v1.include_router(reports.reports_router)
v1.include_router(reports.admin_router)
api_router.include_router(v1)
