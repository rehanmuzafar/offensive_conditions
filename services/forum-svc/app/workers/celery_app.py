"""Celery app configuration."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "forum-svc",
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
    "recompute-thread-stats": {
        "task": "app.workers.tasks.recompute_thread_stats",
        "schedule": 600.0,  # 10 min
    },
    "recompute-reputation": {
        "task": "app.workers.tasks.recompute_reputation",
        "schedule": crontab(hour="5", minute="0"),  # daily 05:00 UTC
    },
    "flush-view-counts": {
        "task": "app.workers.tasks.flush_view_counts",
        "schedule": 300.0,
    },
    "expire-deleted-posts": {
        "task": "app.workers.tasks.expire_deleted_posts",
        "schedule": crontab(hour="6", minute="0"),
    },
    "render-pending-markdown": {
        "task": "app.workers.tasks.render_pending_markdown",
        "schedule": 60.0,
    },
}
