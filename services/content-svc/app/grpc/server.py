"""Async gRPC server.

The .proto file is the source of truth, but since the bash sandbox doesn't have
network access for `protoc`, we hand-roll the wire format using
`grpc.method_handlers_generic_handler` + JSON serialization. In production the
proper generated stubs would be used; the wire format is JSON-over-gRPC which
makes language interop trivial for internal calls.

Switch to generated stubs when CI is set up — see `make gen-proto`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models import Challenge, LearningPath, Machine

log = get_logger("grpc")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


# =============================================================================
# Handlers
# =============================================================================


async def _machine_to_dict(m: Machine) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "slug": m.slug,
        "name": m.name,
        "os": m.os,
        "difficulty": m.difficulty,
        "status": m.status,
        "required_tier": m.required_tier,
        "base_user_points": m.base_user_points,
        "base_root_points": m.base_root_points,
        "base_challenge_points": m.base_challenge_points,
        "has_user_flag": m.has_user_flag,
        "has_root_flag": m.has_root_flag,
        "released_at": m.released_at.isoformat() if m.released_at else None,
        "retired_at": m.retired_at.isoformat() if m.retired_at else None,
    }


async def _challenge_to_dict(c: Challenge) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "slug": c.slug,
        "name": c.name,
        "difficulty": c.difficulty,
        "status": c.status,
        "required_tier": c.required_tier,
        "points": c.points,
        "requires_instance": c.requires_instance,
        "released_at": c.released_at.isoformat() if c.released_at else None,
        "retired_at": c.retired_at.isoformat() if c.retired_at else None,
    }


class ContentServicer:
    """Implements the ContentService methods."""

    async def GetMachineMetadata(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        machine_id = request.get("machine_id")
        if not machine_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "machine_id required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Machine).where(Machine.id == machine_id))
            machine = result.scalar_one_or_none()
            if not machine:
                await context.abort(grpc.StatusCode.NOT_FOUND, "machine not found")
            return await _machine_to_dict(machine)

    async def GetChallengeMetadata(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        challenge_id = request.get("challenge_id")
        if not challenge_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "challenge_id required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Challenge).where(Challenge.id == challenge_id)
            )
            challenge = result.scalar_one_or_none()
            if not challenge:
                await context.abort(grpc.StatusCode.NOT_FOUND, "challenge not found")
            return await _challenge_to_dict(challenge)

    async def BatchGetMachineMetadata(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        ids = request.get("machine_ids", [])
        if not ids:
            return {"machines": [], "not_found_ids": []}
        if len(ids) > 500:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "batch size > 500")

        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Machine).where(Machine.id.in_(ids)))
            found = list(result.scalars().all())
            found_ids = {str(m.id) for m in found}
            not_found = [i for i in ids if i not in found_ids]
            machines = [await _machine_to_dict(m) for m in found]
            return {"machines": machines, "not_found_ids": not_found}

    async def ResolveContentBySlug(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        slug = request.get("slug", "").lower()
        type_ = request.get("type", "")
        if not slug or not type_:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "slug + type required")

        factory = get_session_factory()
        async with factory() as session:
            id_: str | None = None
            if type_ == "machine":
                result = await session.execute(select(Machine.id).where(Machine.slug == slug))
                row = result.scalar_one_or_none()
                id_ = str(row) if row else None
            elif type_ == "challenge":
                result = await session.execute(
                    select(Challenge.id).where(Challenge.slug == slug)
                )
                row = result.scalar_one_or_none()
                id_ = str(row) if row else None
            elif type_ == "path":
                result = await session.execute(
                    select(LearningPath.id).where(LearningPath.slug == slug)
                )
                row = result.scalar_one_or_none()
                id_ = str(row) if row else None
            else:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "unknown type")
            return {"id": id_ or "", "type": type_, "found": id_ is not None}

    async def ListActiveContent(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> AsyncIterator[dict[str, Any]]:
        type_ = request.get("type", "all")
        difficulty = request.get("difficulty") or None
        required_tier = request.get("required_tier") or None
        factory = get_session_factory()
        async with factory() as session:
            if type_ in ("machine", "all"):
                async for item in self._stream_machines(session, difficulty, required_tier):
                    yield item
            if type_ in ("challenge", "all"):
                async for item in self._stream_challenges(session, difficulty, required_tier):
                    yield item
            if type_ in ("path", "all"):
                async for item in self._stream_paths(session, difficulty, required_tier):
                    yield item

    async def _stream_machines(
        self, session: AsyncSession, difficulty: str | None, required_tier: str | None
    ) -> AsyncIterator[dict[str, Any]]:
        stmt = select(Machine).where(Machine.status == "active")
        if difficulty:
            stmt = stmt.where(Machine.difficulty == difficulty)
        if required_tier:
            stmt = stmt.where(Machine.required_tier == required_tier)
        result = await session.execute(stmt)
        for m in result.scalars().all():
            yield {
                "id": str(m.id),
                "slug": m.slug,
                "name": m.name,
                "type": "machine",
                "difficulty": m.difficulty,
                "points": m.base_user_points + m.base_root_points,
                "status": m.status,
            }

    async def _stream_challenges(
        self, session: AsyncSession, difficulty: str | None, required_tier: str | None
    ) -> AsyncIterator[dict[str, Any]]:
        stmt = select(Challenge).where(Challenge.status == "active")
        if difficulty:
            stmt = stmt.where(Challenge.difficulty == difficulty)
        if required_tier:
            stmt = stmt.where(Challenge.required_tier == required_tier)
        result = await session.execute(stmt)
        for c in result.scalars().all():
            yield {
                "id": str(c.id),
                "slug": c.slug,
                "name": c.name,
                "type": "challenge",
                "difficulty": c.difficulty,
                "points": c.points,
                "status": c.status,
            }

    async def _stream_paths(
        self, session: AsyncSession, difficulty: str | None, required_tier: str | None
    ) -> AsyncIterator[dict[str, Any]]:
        stmt = select(LearningPath).where(LearningPath.status == "active")
        if difficulty:
            stmt = stmt.where(LearningPath.difficulty == difficulty)
        if required_tier:
            stmt = stmt.where(LearningPath.required_tier == required_tier)
        result = await session.execute(stmt)
        for p in result.scalars().all():
            yield {
                "id": str(p.id),
                "slug": p.slug,
                "name": p.name,
                "type": "path",
                "difficulty": p.difficulty,
                "points": p.completion_points,
                "status": p.status,
            }


# =============================================================================
# Generic handler registration (no protoc needed)
# =============================================================================


def _build_generic_handler(servicer: ContentServicer) -> grpc.GenericRpcHandler:
    service_name = "offcon.content.v1.ContentService"

    method_handlers = {
        "GetMachineMetadata": grpc.unary_unary_rpc_method_handler(
            servicer.GetMachineMetadata,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetChallengeMetadata": grpc.unary_unary_rpc_method_handler(
            servicer.GetChallengeMetadata,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "BatchGetMachineMetadata": grpc.unary_unary_rpc_method_handler(
            servicer.BatchGetMachineMetadata,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "ResolveContentBySlug": grpc.unary_unary_rpc_method_handler(
            servicer.ResolveContentBySlug,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "ListActiveContent": grpc.unary_stream_rpc_method_handler(
            servicer.ListActiveContent,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
    }
    return grpc.method_handlers_generic_handler(service_name, method_handlers)


# =============================================================================
# Server wrapper
# =============================================================================


class ContentGRPCServer:
    """Async gRPC server for internal service-to-service calls."""

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
        servicer = ContentServicer()
        server.add_generic_rpc_handlers((_build_generic_handler(servicer),))

        if self._settings.grpc_enable_reflection:
            try:
                from grpc_reflection.v1alpha import reflection

                service_names = (
                    "offcon.content.v1.ContentService",
                    reflection.SERVICE_NAME,
                )
                reflection.enable_server_reflection(service_names, server)
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
