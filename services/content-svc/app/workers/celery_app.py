"""Celery app configuration with beat schedule."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "content-svc",
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
    result_expires=3600,  # 1 hour
)

# Beat schedule — cron-style periodic tasks
celery_app.conf.beat_schedule = {
    "refresh-machine-stats": {
        "task": "app.workers.tasks.refresh_machine_stats",
        "schedule": 300.0,  # every 5 minutes
    },
    "refresh-challenge-stats": {
        "task": "app.workers.tasks.refresh_challenge_stats",
        "schedule": 300.0,
    },
    "refresh-path-stats": {
        "task": "app.workers.tasks.refresh_path_stats",
        "schedule": 600.0,  # every 10 min
    },
    "expire-drafts": {
        "task": "app.workers.tasks.expire_drafts",
        "schedule": crontab(hour="3", minute="0"),  # daily at 03:00 UTC
    },
    "reindex-search": {
        "task": "app.workers.tasks.reindex_search",
        "schedule": crontab(hour="4", minute="0"),  # daily at 04:00 UTC
    },
}
