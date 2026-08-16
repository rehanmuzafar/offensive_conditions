"""v1 routes aggregation."""

from fastapi import APIRouter

from app.api.v1 import activity, chat, insights, payments, progress, challenges, events, health, team_stats, ws

api_router = APIRouter()
api_router.include_router(health.router)  # /livez, /readyz

v1 = APIRouter(prefix="/v1")
v1.include_router(events.router)
v1.include_router(payments.router)
v1.include_router(progress.router)
v1.include_router(chat.router)
v1.include_router(activity.router)
v1.include_router(insights.router)
v1.include_router(challenges.router)
v1.include_router(team_stats.router)
v1.include_router(team_stats.user_router)
v1.include_router(ws.router)
api_router.include_router(v1)
