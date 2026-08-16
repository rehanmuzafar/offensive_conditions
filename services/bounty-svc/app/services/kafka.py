"""Kafka producer + consumer for bounty events."""

from __future__ import annotations

import asyncio
import json
import ssl
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("kafka")


class EventType:
    REPORT_SUBMITTED = "bounty.report.submitted"
    REPORT_TRIAGED = "bounty.report.triaged"
    REPORT_ACCEPTED = "bounty.report.accepted"
    REPORT_REJECTED = "bounty.report.rejected"
    REPORT_DUPLICATE = "bounty.report.duplicate"
    REPORT_INFORMATIONAL = "bounty.report.informational"
    REPORT_RESOLVED = "bounty.report.resolved"
    REPORT_AWARDED = "bounty.report.awarded"
    REPORT_PAID = "bounty.report.paid"
    REPORT_CLOSED = "bounty.report.closed"
    REPORT_COMMENT_ADDED = "bounty.report.comment.added"
    PAYOUT_REQUESTED = "bounty.payout.requested"
    PAYOUT_COMPLETED = "bounty.payout.completed"
    PAYOUT_FAILED = "bounty.payout.failed"
    PROGRAM_PUBLISHED = "bounty.program.published"
    PROGRAM_PAUSED = "bounty.program.paused"
    PROGRAM_CLOSED = "bounty.program.closed"


def _producer_kwargs(settings: Settings) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "bootstrap_servers": settings.kafka_brokers,
        "value_serializer": lambda v: json.dumps(v, default=str).encode("utf-8"),
        "key_serializer": lambda v: v.encode("utf-8") if v else None,
        # gzip, not snappy: python-snappy is not installed anywhere (and needs a
            # system libsnappy), so the producer failed to start and every
            # event was silently dropped. gzip ships with aiokafka.
            "compression_type": "gzip",
        "acks": settings.kafka_acks if settings.kafka_acks != "one" else 1,
        "enable_idempotence": True,
    }
    if settings.kafka_use_tls:
        kwargs["security_protocol"] = "SSL"
        kwargs["ssl_context"] = ssl.create_default_context()
    return kwargs


class BountyEventPublisher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._producer: AIOKafkaProducer | None = None
        self._topic = settings.kafka_topic_bounty_events

    async def start(self) -> None:
        if self._producer is not None:
            return
        self._producer = AIOKafkaProducer(**_producer_kwargs(self._settings))
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
        subject_id: UUID | str,
        actor_id: UUID | str | None = None,
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


class PaymentEventConsumer:
    """Consumes `payment.events` to track payout settlement."""

    def __init__(
        self,
        settings: Settings,
        on_payout_sent: Callable[[dict[str, Any]], Awaitable[None]],
        on_payout_failed: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        self._settings = settings
        self._consumer: AIOKafkaConsumer | None = None
        self._on_payout_sent = on_payout_sent
        self._on_payout_failed = on_payout_failed
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._consumer is not None:
            return
        cfg = self._settings
        kwargs: dict[str, Any] = {
            "bootstrap_servers": cfg.kafka_brokers,
            "group_id": cfg.kafka_consumer_group,
            "enable_auto_commit": True,
            "auto_commit_interval_ms": 5_000,
            "session_timeout_ms": 30_000,
        }
        if cfg.kafka_use_tls:
            kwargs["security_protocol"] = "SSL"
            kwargs["ssl_context"] = ssl.create_default_context()
        self._consumer = AIOKafkaConsumer(
            cfg.kafka_topic_payment_events,
            **kwargs,
        )
        await self._consumer.start()
        self._task = asyncio.create_task(self._loop())
        log.info(
            "kafka_consumer_started",
            topic=cfg.kafka_topic_payment_events,
            group=cfg.kafka_consumer_group,
        )

    async def _loop(self) -> None:
        assert self._consumer is not None
        try:
            async for message in self._consumer:
                if message.value is None:
                    continue
                try:
                    envelope = json.loads(message.value.decode("utf-8"))
                except Exception:
                    log.warning("consumer_parse_failed", offset=message.offset)
                    continue
                event_type = envelope.get("event_type")
                payload = envelope.get("payload", {})
                try:
                    if event_type == "payment.payout.sent":
                        await self._on_payout_sent(payload)
                    elif event_type == "payment.payout.failed":
                        await self._on_payout_failed(payload)
                except Exception:
                    log.exception("payment_event_handler_failed", event_type=event_type)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("kafka_consumer_loop_crashed")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        if self._consumer is not None:
            await self._consumer.stop()
            self._consumer = None
