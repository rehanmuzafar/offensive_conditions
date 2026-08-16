"""Celery app configuration."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "writeup-svc",
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
    task_default_retry_delay=30,
    task_max_retries=3,
    worker_max_tasks_per_child=1000,
    worker_prefetch_multiplier=2,
    broker_connection_retry_on_startup=True,
    result_expires=3600,
)

celery_app.conf.beat_schedule = {
    "render-writeup-markdown": {
        "task": "app.workers.tasks.render_writeup_markdown",
        "schedule": 60.0,
    },
    "recompute-writeup-stats": {
        "task": "app.workers.tasks.recompute_writeup_stats",
        "schedule": 600.0,
    },
    "flush-view-counts": {
        "task": "app.workers.tasks.flush_view_counts",
        "schedule": 300.0,
    },
    "archive-old-rejected": {
        "task": "app.workers.tasks.archive_old_rejected",
        "schedule": crontab(hour="7", minute="0"),
    },
}
