"""WebSocket connection broker.

Redis pubsub fans messages out across ctf-svc replicas: a solve handled on one
replica reaches clients connected to any other.

Channels are scoped, and the scope a connection gets is resolved server-side
from the caller's own participation — a client cannot ask to listen to another
team's channel:

  ctf:event:{event}                    everyone in the event (solves, status)
  ctf:event:{event}:announce           pinned announcements
  ctf:event:{event}:team:{team}        one team (progress, chat)
  ctf:event:{event}:user:{user}        one player (their own instances)
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any
from uuid import UUID

from redis.asyncio import Redis

from app.core.logging import get_logger

log = get_logger("ws")

# A subscription is identified by the exact set of scopes it listens on.
SubKey = tuple[UUID, UUID | None, UUID | None]


def event_channel(event_id: UUID) -> str:
    return f"ctf:event:{event_id}"


def event_announce_channel(event_id: UUID) -> str:
    return f"ctf:event:{event_id}:announce"


def team_channel(event_id: UUID, team_id: UUID) -> str:
    return f"ctf:event:{event_id}:team:{team_id}"


def user_channel(event_id: UUID, user_id: UUID) -> str:
    return f"ctf:event:{event_id}:user:{user_id}"


def _channels_for(event_id: UUID, team_id: UUID | None, user_id: UUID | None) -> list[str]:
    channels = [event_channel(event_id), event_announce_channel(event_id)]
    if team_id:
        channels.append(team_channel(event_id, team_id))
    if user_id:
        channels.append(user_channel(event_id, user_id))
    return channels


class WebSocketBroker:
    """Local WS connections plus the Redis pubsub bridge."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        # One queue per connected client, grouped by the scopes it listens on.
        self._subs: dict[SubKey, set[asyncio.Queue[str]]] = defaultdict(set)
        # One Redis subscription task per distinct scope combination.
        self._tasks: dict[SubKey, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(
        self,
        event_id: UUID,
        *,
        team_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> tuple[asyncio.Queue[str], SubKey]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=128)
        key: SubKey = (event_id, team_id, user_id)
        async with self._lock:
            self._subs[key].add(queue)
            if key not in self._tasks:
                self._tasks[key] = asyncio.create_task(
                    self._subscribe_loop(key), name=f"ctf-ws-sub-{event_id}"
                )
        log.debug("ws_subscribed", event_id=str(event_id), clients=len(self._subs[key]))
        return queue, key

    async def unsubscribe(self, key: SubKey, queue: asyncio.Queue[str]) -> None:
        async with self._lock:
            self._subs[key].discard(queue)
            if not self._subs[key]:
                self._subs.pop(key, None)
                task = self._tasks.pop(key, None)
                if task and not task.done():
                    task.cancel()

    # ----------------------------------------------------------- publishing
    async def _publish(self, channel: str, message: dict[str, Any]) -> None:
        try:
            await self._redis.publish(channel, json.dumps(message, default=str))
        except Exception:
            log.exception("ws_publish_failed", channel=channel)

    async def broadcast(self, event_id: UUID, message: dict[str, Any]) -> None:
        """Everyone in the event."""
        await self._publish(event_channel(event_id), message)

    async def broadcast_announcement(self, event_id: UUID, message: dict[str, Any]) -> None:
        await self._publish(event_announce_channel(event_id), message)

    async def to_team(self, event_id: UUID, team_id: UUID, message: dict[str, Any]) -> None:
        """Only that team — progress changes, chat."""
        await self._publish(team_channel(event_id, team_id), message)

    async def to_user(self, event_id: UUID, user_id: UUID, message: dict[str, Any]) -> None:
        """Only that player — their own spawned instance, for example."""
        await self._publish(user_channel(event_id, user_id), message)

    # ---------------------------------------------------------- subscribing
    async def _subscribe_loop(self, key: SubKey) -> None:
        event_id, team_id, user_id = key
        channels = _channels_for(event_id, team_id, user_id)
        log.info("ws_redis_sub_starting", event_id=str(event_id), channels=len(channels))
        pubsub = self._redis.pubsub()
        try:
            await pubsub.subscribe(*channels)
            async for raw in pubsub.listen():
                if raw.get("type") != "message":
                    continue
                data = raw.get("data")
                payload = data.decode() if isinstance(data, bytes) else str(data)
                async with self._lock:
                    queues = list(self._subs.get(key, ()))
                for q in queues:
                    try:
                        q.put_nowait(payload)
                    except asyncio.QueueFull:
                        # A stalled client must not block the fan-out.
                        log.warning("ws_queue_full_dropping", event_id=str(event_id))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("ws_redis_sub_failed", event_id=str(event_id))
        finally:
            try:
                await pubsub.unsubscribe(*channels)
                await pubsub.aclose()
            except Exception:
                pass

    async def close_all(self) -> None:
        async with self._lock:
            tasks = list(self._tasks.values())
            self._tasks.clear()
            self._subs.clear()
        for t in tasks:
            if not t.done():
                t.cancel()
        for t in tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
