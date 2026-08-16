"""WebSocket live feed for CTF events.

URL: WS /v1/events/:event_id/live?token=<jwt>

Auth: JWT passed as query param (since browser WS APIs can't set Authorization
headers). For native clients, the `subprotocol` header is also supported.

Message flow:
  client → server: { "type": "ping" } / { "type": "subscribe" }
  server → client: { "type": "solve", ... }
                  { "type": "announcement", ... }
                  { "type": "event.started" }
                  { "type": "event.ended" }
                  { "type": "pong" }
"""

from __future__ import annotations

import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from starlette.websockets import WebSocketState

from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger("ws-route")

router = APIRouter(prefix="/events", tags=["websocket"])


@router.websocket("/{event_id}/live")
async def live_feed(
    websocket: WebSocket,
    event_id: UUID,
    token: str = Query(...),
) -> None:
    # Validate JWT
    validator = websocket.app.state.validator
    settings = websocket.app.state.settings
    try:
        claims = validator.validate(token)
    except AppError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized")
        return

    broker = websocket.app.state.ws_broker

    # Scope this connection to what the caller is actually part of. Deriving it
    # here (rather than accepting a team id from the client) is what stops one
    # team subscribing to another team's channel.
    team_id = None
    try:
        from app.db.session import get_session_factory
        from app.services.registration import RegistrationService

        async with get_session_factory()() as session:
            participation = await RegistrationService(session).get_my_participation(
                event_id, user_id=claims.user_id, bearer=f"Bearer {token}"
            )
            if participation is not None:
                team_id = participation.team_id
    except Exception:
        log.warning("ws_scope_lookup_failed", event_id=str(event_id))

    queue, sub_key = await broker.subscribe(
        event_id, team_id=team_id, user_id=claims.user_id
    )

    await websocket.accept()
    log.info(
        "ws_client_connected",
        event_id=str(event_id),
        user_id=str(claims.user_id),
        team_id=str(team_id) if team_id else None,
    )

    heartbeat_seconds = settings.ws_heartbeat_seconds
    idle_timeout = settings.ws_idle_timeout_seconds

    receive_task: asyncio.Task[None] | None = None
    send_task: asyncio.Task[None] | None = None
    heartbeat_task: asyncio.Task[None] | None = None

    async def _send_loop() -> None:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=idle_timeout)
            except asyncio.TimeoutError:
                # Idle timeout: send a server-initiated ping
                await websocket.send_text(json.dumps({"type": "idle"}))
                continue
            if websocket.client_state != WebSocketState.CONNECTED:
                return
            await websocket.send_text(msg)

    async def _receive_loop() -> None:
        while True:
            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                # A client closing the tab is normal (code 1000). Letting it
                # bubble logged a traceback per disconnect, which would bury
                # real errors during an event.
                return
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    async def _heartbeat_loop() -> None:
        while True:
            await asyncio.sleep(heartbeat_seconds)
            if websocket.client_state != WebSocketState.CONNECTED:
                return
            try:
                await websocket.send_text(json.dumps({"type": "heartbeat"}))
            except Exception:
                return

    try:
        send_task = asyncio.create_task(_send_loop(), name=f"ws-send-{event_id}")
        receive_task = asyncio.create_task(_receive_loop(), name=f"ws-recv-{event_id}")
        heartbeat_task = asyncio.create_task(_heartbeat_loop(), name=f"ws-hb-{event_id}")

        done, pending = await asyncio.wait(
            {send_task, receive_task, heartbeat_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        log.info("ws_client_disconnected", event_id=str(event_id))
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("ws_unexpected", event_id=str(event_id))
    finally:
        for task in (receive_task, send_task, heartbeat_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        await broker.unsubscribe(sub_key, queue)
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
        log.info("ws_cleanup_done", event_id=str(event_id), user_id=str(claims.user_id))
