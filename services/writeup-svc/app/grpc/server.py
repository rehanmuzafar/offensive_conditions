"""Async gRPC server (JSON-over-gRPC pattern)."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc
from sqlalchemy import and_, select

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models import Writeup

log = get_logger("grpc")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


def _writeup_to_dict(w: Writeup) -> dict[str, Any]:
    return {
        "id": str(w.id),
        "author_id": str(w.author_id),
        "content_type": w.content_type,
        "content_id": str(w.content_id),
        "title": w.title,
        "slug": w.slug,
        "language": w.language,
        "status": w.status,
        "is_featured": w.is_featured,
        "view_count": w.view_count,
        "score": w.score,
        "comment_count": w.comment_count,
        "published_at": w.published_at.isoformat() if w.published_at else None,
    }


class WriteupServicer:
    async def GetWriteupMetadata(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        writeup_id = request.get("writeup_id")
        if not writeup_id:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "writeup_id required"
            )
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Writeup).where(Writeup.id == writeup_id)
            )
            w = result.scalar_one_or_none()
            if not w:
                await context.abort(grpc.StatusCode.NOT_FOUND, "writeup not found")
            return _writeup_to_dict(w)

    async def BatchGetWriteupsByTarget(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        content_type = request.get("content_type")
        content_ids = request.get("content_ids", [])
        if not content_type or not content_ids:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "content_type + content_ids required",
            )
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Writeup).where(
                    and_(
                        Writeup.content_type == content_type,
                        Writeup.content_id.in_(content_ids),
                        Writeup.status == "approved",
                        Writeup.deleted_at.is_(None),
                    )
                )
            )
            items = [_writeup_to_dict(w) for w in result.scalars().all()]
            return {"writeups": items}

    async def CheckReadAccess(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        writeup_id = request.get("writeup_id")
        user_id = request.get("user_id")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Writeup).where(Writeup.id == writeup_id)
            )
            w = result.scalar_one_or_none()
            if not w or w.deleted_at is not None:
                return {"can_read": False, "reason": "not_found"}
            if w.status != "approved":
                if user_id and str(w.author_id) == user_id:
                    return {"can_read": True, "reason": ""}
                return {"can_read": False, "reason": "not_published"}
            # In production: gRPC call to scoring-svc to check has_solved.
            # For now, allow.
            return {"can_read": True, "reason": ""}


def _build_handler(servicer: WriteupServicer) -> grpc.GenericRpcHandler:
    service_name = "offcon.writeup.v1.WriteupService"
    handlers = {
        "GetWriteupMetadata": grpc.unary_unary_rpc_method_handler(
            servicer.GetWriteupMetadata,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "BatchGetWriteupsByTarget": grpc.unary_unary_rpc_method_handler(
            servicer.BatchGetWriteupsByTarget,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "CheckReadAccess": grpc.unary_unary_rpc_method_handler(
            servicer.CheckReadAccess,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
    }
    return grpc.method_handlers_generic_handler(service_name, handlers)


class WriteupGRPCServer:
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
        ]
        server = grpc.aio.server(
            migration_thread_pool=ThreadPoolExecutor(max_workers=4),
            options=options,
        )
        server.add_generic_rpc_handlers((_build_handler(WriteupServicer()),))

        if self._settings.grpc_enable_reflection:
            try:
                from grpc_reflection.v1alpha import reflection

                reflection.enable_server_reflection(
                    ("offcon.writeup.v1.WriteupService", reflection.SERVICE_NAME),
                    server,
                )
            except ImportError:
                pass

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
