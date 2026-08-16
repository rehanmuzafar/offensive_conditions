"""Kafka event publisher."""

from __future__ import annotations

import asyncio
import json
import ssl
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from aiokafka import AIOKafkaProducer

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("kafka")


class EventType:
    SUBMITTED = "writeup.submitted"
    UPDATED = "writeup.updated"
    APPROVED = "writeup.approved"
    REJECTED = "writeup.rejected"
    FEATURED = "writeup.featured"
    UNFEATURED = "writeup.unfeatured"
    ARCHIVED = "writeup.archived"

    VOTE_CAST = "writeup.vote.cast"
    BOOKMARK_ADDED = "writeup.bookmark.added"
    BOOKMARK_REMOVED = "writeup.bookmark.removed"

    COMMENT_CREATED = "writeup.comment.created"
    COMMENT_EDITED = "writeup.comment.edited"
    COMMENT_DELETED = "writeup.comment.deleted"
    COMMENT_VOTE_CAST = "writeup.comment.vote.cast"


class WriteupEventPublisher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._producer: AIOKafkaProducer | None = None
        self._topic = settings.kafka_topic_writeup_events

    async def start(self) -> None:
        if self._producer is not None:
            return
        kwargs: dict[str, Any] = {
            "bootstrap_servers": self._settings.kafka_brokers,
            "value_serializer": lambda v: json.dumps(v, default=str).encode("utf-8"),
            "key_serializer": lambda v: v.encode("utf-8") if v else None,
            # gzip, not snappy: python-snappy is not installed anywhere (and needs a
            # system libsnappy), so the producer failed to start and every
            # event was silently dropped. gzip ships with aiokafka.
            "compression_type": "gzip",
            "acks": self._settings.kafka_acks if self._settings.kafka_acks != "one" else 1,
            "enable_idempotence": True,
        }
        if self._settings.kafka_use_tls:
            kwargs["security_protocol"] = "SSL"
            kwargs["ssl_context"] = ssl.create_default_context()
        self._producer = AIOKafkaProducer(**kwargs)
        await self._producer.start()
        log.info("kafka_producer_started", topic=self._topic)

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()
            self._producer = None

    async def publish(
        self,
        *,
        event_type: str,
        subject_id: UUID,
        actor_id: UUID | None = None,
        payload: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        if self._producer is None:
            return
        envelope = {
            "event_id": str(uuid4()),
            "event_type": event_type,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "subject_id": str(subject_id),
            "actor_user_id": str(actor_id) if actor_id else None,
            "payload": payload or {},
            "request_id": request_id,
        }
        try:
            await self._producer.send_and_wait(
                self._topic,
                value=envelope,
                key=str(subject_id),
                headers=[
                    ("event_type", event_type.encode("utf-8")),
                    ("event_id", envelope["event_id"].encode("utf-8")),
                ],
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("publish_failed", event_type=event_type)
