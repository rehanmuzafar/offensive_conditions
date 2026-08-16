"""Kafka consumer that listens to flag-verifier events.

When flag-verifier accepts a flag for a CTF challenge (these have
subject_type='ctf_challenge' in the event payload), we still record the solve
through the HTTP `/submit` endpoint, so this consumer is for cross-check audits
and downstream analytics — it does not write to the database directly.

Run as a separate process: `python -m app.workers.kafka_consumer`
"""

from __future__ import annotations

import asyncio
import json
import signal
from typing import Any

from aiokafka import AIOKafkaConsumer

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger


async def _consume() -> None:
    settings = get_settings()
    log = configure_logging(settings)
    log.info("kafka_consumer_starting")

    consumer = AIOKafkaConsumer(
        settings.kafka_topic_flagverify_events,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_consumer_group,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")) if v else None,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
        max_poll_records=100,
    )
    await consumer.start()

    stop_event = asyncio.Event()

    def _on_signal(*_: Any) -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _on_signal)

    try:
        while not stop_event.is_set():
            batch = await consumer.getmany(timeout_ms=2000, max_records=100)
            messages = [msg for tp_msgs in batch.values() for msg in tp_msgs]
            if not messages:
                continue
            for msg in messages:
                envelope = msg.value
                if not envelope:
                    continue
                event_type = envelope.get("event_type", "")
                if event_type not in (
                    "flagverify.flag.accepted",
                    "flagverify.flag.rejected",
                ):
                    continue
                payload = envelope.get("payload", {})
                if payload.get("subject_type") != "ctf_challenge":
                    continue
                log.info(
                    "flag_event_received",
                    event_type=event_type,
                    challenge_id=payload.get("challenge_id"),
                    event_id=payload.get("event_id"),
                    accepted=event_type.endswith("accepted"),
                )
                # Hook for analytics/audit — write to ClickHouse, Slack, etc.
            await consumer.commit()
    except Exception:
        log = get_logger("kafka")
        log.exception("kafka_consumer_failed")
        raise
    finally:
        await consumer.stop()
        log = get_logger("kafka")
        log.info("kafka_consumer_stopped")


if __name__ == "__main__":
    asyncio.run(_consume())
