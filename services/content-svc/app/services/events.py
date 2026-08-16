"""Kafka event producer for content lifecycle events."""

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


# Event type constants
class EventType:
    MACHINE_CREATED = "content.machine.created"
    MACHINE_PUBLISHED = "content.machine.published"
    MACHINE_RETIRED = "content.machine.retired"
    MACHINE_UPDATED = "content.machine.updated"
    MACHINE_RATED = "content.machine.rated"

    CHALLENGE_CREATED = "content.challenge.created"
    CHALLENGE_PUBLISHED = "content.challenge.published"
    CHALLENGE_RETIRED = "content.challenge.retired"
    CHALLENGE_UPDATED = "content.challenge.updated"

    PATH_ENROLLED = "content.path.enrolled"
    PATH_COMPLETED = "content.path.completed"
    PATH_MODULE_COMPLETED = "content.path.module_completed"


class ContentEventPublisher:
    """Publishes content events to Kafka."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._producer: AIOKafkaProducer | None = None
        self._topic = settings.kafka_topic_content_events

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
        log.info("kafka_producer_started", brokers=self._settings.kafka_brokers, topic=self._topic)

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()
            self._producer = None
            log.info("kafka_producer_stopped")

    async def publish(
        self,
        *,
        event_type: str,
        subject_id: UUID,
        actor_id: UUID | None = None,
        payload: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        """Publish a content event. Best-effort — does not raise on failure."""
        if self._producer is None:
            log.warning("publish_skipped_no_producer", event_type=event_type)
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
            log.debug("event_published", event_type=event_type, subject_id=str(subject_id))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("publish_failed", event_type=event_type, subject_id=str(subject_id))
