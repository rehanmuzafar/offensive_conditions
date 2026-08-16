"""Celery app configuration with beat schedule."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "ctf-svc",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_default_retry_delay=15,
    task_max_retries=3,
    worker_max_tasks_per_child=1000,
    worker_prefetch_multiplier=2,
    broker_connection_retry_on_startup=True,
    result_expires=3600,
)

celery_app.conf.beat_schedule = {
    # Lifecycle: advance events through state machine based on timestamps
    "transition-event-status": {
        "task": "app.workers.tasks.transition_event_status",
        "schedule": 30.0,  # every 30 sec
    },
    # Ranking: rebuild rank column for live events
    "recompute-ranks": {
        "task": "app.workers.tasks.recompute_ranks",
        "schedule": 30.0,
    },
    # Dynamic scoring: re-derive current_points for live event challenges
    "recompute-dynamic-scores": {
        "task": "app.workers.tasks.recompute_dynamic_scores",
        "schedule": 60.0,
    },
    # Freeze: snapshot scoreboards reaching freeze time
    "snapshot-frozen-scoreboards": {
        "task": "app.workers.tasks.snapshot_frozen_scoreboards",
        "schedule": 30.0,
    },
    # Cleanup: archive ended events after 30 days
    "archive-old-events": {
        "task": "app.workers.tasks.archive_old_events",
        "schedule": crontab(hour="4", minute="30"),  # daily 04:30 UTC
    },
}
