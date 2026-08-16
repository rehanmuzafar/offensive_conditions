"""Async gRPC server (JSON-over-gRPC, see ctf-svc + content-svc for rationale)."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc
from sqlalchemy import and_, select

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models import Category, Thread, UserReputation

log = get_logger("grpc")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


class ForumServicer:
    async def GetThreadMetadata(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        thread_id = request.get("thread_id")
        if not thread_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "thread_id required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Thread).where(Thread.id == thread_id))
            t = result.scalar_one_or_none()
            if not t:
                await context.abort(grpc.StatusCode.NOT_FOUND, "thread not found")
            return {
                "id": str(t.id),
                "slug": t.slug,
                "title": t.title,
                "status": t.status,
                "author_id": str(t.author_id),
                "category_id": str(t.category_id),
                "is_solved": t.is_solved,
                "reply_count": t.reply_count,
                "view_count": t.view_count,
                "tags": t.tags,
            }

    async def GetUserReputation(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        user_id = request.get("user_id")
        if not user_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "user_id required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(UserReputation).where(UserReputation.user_id == user_id)
            )
            rep = result.scalar_one_or_none()
            if not rep:
                return {
                    "user_id": str(user_id),
                    "reputation": 0,
                    "posts_count": 0,
                    "threads_count": 0,
                    "solutions_accepted": 0,
                }
            return {
                "user_id": str(rep.user_id),
                "reputation": rep.reputation,
                "posts_count": rep.posts_count,
                "threads_count": rep.threads_count,
                "solutions_accepted": rep.solutions_accepted,
            }

    async def CheckThreadAccess(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        thread_id = request.get("thread_id")
        viewer_tier = request.get("viewer_tier", "free")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Thread, Category).join(
                    Category, Category.id == Thread.category_id
                ).where(Thread.id == thread_id)
            )
            row = result.one_or_none()
            if not row:
                return {"can_view": False, "reason": "not_found"}
            thread, category = row
            tier_order = {"free": 0, "vip": 1, "vip_plus": 2}
            if tier_order.get(viewer_tier, 0) < tier_order.get(category.required_tier, 0):
                return {"can_view": False, "reason": "tier_required"}
            return {"can_view": True, "reason": ""}


def _build_handler(servicer: ForumServicer) -> grpc.GenericRpcHandler:
    service_name = "offcon.forum.v1.ForumService"
    handlers = {
        "GetThreadMetadata": grpc.unary_unary_rpc_method_handler(
            servicer.GetThreadMetadata,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetUserReputation": grpc.unary_unary_rpc_method_handler(
            servicer.GetUserReputation,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "CheckThreadAccess": grpc.unary_unary_rpc_method_handler(
            servicer.CheckThreadAccess,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
    }
    return grpc.method_handlers_generic_handler(service_name, handlers)


class ForumGRPCServer:
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
        server.add_generic_rpc_handlers((_build_handler(ForumServicer()),))

        if self._settings.grpc_enable_reflection:
            try:
                from grpc_reflection.v1alpha import reflection

                reflection.enable_server_reflection(
                    ("offcon.forum.v1.ForumService", reflection.SERVICE_NAME), server
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
