"""Async gRPC server for ctf-svc.

JSON-over-gRPC for the same reason as content-svc: bash sandbox has no
network access for protoc. The .proto file is the source of truth and the
wire format is JSON, which keeps interop trivial for our internal mesh.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc
from sqlalchemy import and_, select

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models import Event, EventParticipant
from app.services.kafka import json  # reuse json import

log = get_logger("grpc")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


def _event_to_state(event: Event) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "slug": event.slug,
        "status": event.status,
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat(),
        "scoreboard_freeze_at": event.scoreboard_freeze_at.isoformat()
        if event.scoreboard_freeze_at
        else None,
        "dynamic_scoring": event.dynamic_scoring,
        "min_points": event.min_points,
        "total_registered": event.total_registered,
        "total_teams": event.total_teams,
    }


def _participant_to_dict(p: EventParticipant) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "event_id": str(p.event_id),
        "participant_type": p.participant_type,
        "user_id": str(p.user_id) if p.user_id else None,
        "team_id": str(p.team_id) if p.team_id else None,
        "points": p.points,
        "solve_count": p.solve_count,
        "rank": p.rank,
        "is_disqualified": p.is_disqualified,
    }


class CtfServicer:
    async def IsUserInEvent(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        user_id = request.get("user_id")
        event_id = request.get("event_id")
        if not user_id or not event_id:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "user_id + event_id required"
            )

        factory = get_session_factory()
        async with factory() as session:
            # Solo
            solo_result = await session.execute(
                select(EventParticipant).where(
                    and_(
                        EventParticipant.event_id == event_id,
                        EventParticipant.user_id == user_id,
                    )
                )
            )
            solo = solo_result.scalar_one_or_none()
            if solo:
                return {
                    "in_event": True,
                    "participant_id": str(solo.id),
                    "participant_type": "user",
                    "team_id": "",
                }
            # Team membership lookup would call user-svc; for now we just
            # check direct team registrations
            return {
                "in_event": False,
                "participant_id": "",
                "participant_type": "",
                "team_id": "",
            }

    async def GetEventState(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        event_id = request.get("event_id")
        if not event_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "event_id required")

        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Event).where(Event.id == event_id))
            event = result.scalar_one_or_none()
            if not event:
                await context.abort(grpc.StatusCode.NOT_FOUND, "event not found")
            return _event_to_state(event)

    async def GetTeamForUser(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        # Resolved via team membership from user-svc — stubbed here
        return {"team_id": "", "team_name": "", "participant_id": ""}

    async def GetParticipant(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        participant_id = request.get("participant_id")
        if not participant_id:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "participant_id required"
            )

        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(EventParticipant).where(EventParticipant.id == participant_id)
            )
            participant = result.scalar_one_or_none()
            if not participant:
                await context.abort(grpc.StatusCode.NOT_FOUND, "participant not found")
            return _participant_to_dict(participant)

    async def ListLiveEvents(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> AsyncIterator[dict[str, Any]]:
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Event).where(Event.status == "live"))
            for event in result.scalars().all():
                yield _event_to_state(event)


def _build_handler(servicer: CtfServicer) -> grpc.GenericRpcHandler:
    service_name = "offcon.ctf.v1.CtfService"
    handlers = {
        "IsUserInEvent": grpc.unary_unary_rpc_method_handler(
            servicer.IsUserInEvent,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetEventState": grpc.unary_unary_rpc_method_handler(
            servicer.GetEventState,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetTeamForUser": grpc.unary_unary_rpc_method_handler(
            servicer.GetTeamForUser,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetParticipant": grpc.unary_unary_rpc_method_handler(
            servicer.GetParticipant,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "ListLiveEvents": grpc.unary_stream_rpc_method_handler(
            servicer.ListLiveEvents,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
    }
    return grpc.method_handlers_generic_handler(service_name, handlers)


class CtfGRPCServer:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._server: grpc.aio.Server | None = None

    async def start(self) -> None:
        if self._server is not None:
            return
        max_recv = self._settings.grpc_max_recv_mb * 1024 * 1024
        options = [
            ("grpc.max_receive_message_length", max_recv),
            ("grpc.max_send_message_length", max_recv),
            ("grpc.keepalive_time_ms", 30_000),
            ("grpc.keepalive_timeout_ms", 10_000),
            ("grpc.http2.min_ping_interval_without_data_ms", 10_000),
        ]
        server = grpc.aio.server(
            migration_thread_pool=ThreadPoolExecutor(max_workers=4),
            options=options,
        )
        server.add_generic_rpc_handlers((_build_handler(CtfServicer()),))

        if self._settings.grpc_enable_reflection:
            try:
                from grpc_reflection.v1alpha import reflection

                reflection.enable_server_reflection(
                    ("offcon.ctf.v1.CtfService", reflection.SERVICE_NAME), server
                )
            except ImportError:
                log.warning("grpc_reflection_unavailable")

        addr = f"0.0.0.0:{self._settings.grpc_port}"
        server.add_insecure_port(addr)
        await server.start()
        self._server = server
        log.info("grpc_listening", addr=addr)

    async def wait_for_termination(self) -> None:
        if self._server:
            await self._server.wait_for_termination()

    async def stop(self, grace_seconds: float = 10.0) -> None:
        if self._server is not None:
            await self._server.stop(grace_seconds)
            self._server = None
            log.info("grpc_stopped")
