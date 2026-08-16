"""Bounty gRPC server (JSON-over-gRPC)."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc
from sqlalchemy import select

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models import Payout, Program, Report

log = get_logger("grpc")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    return json.loads(data.decode("utf-8")) if data else {}


def _report_summary(r: Report) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "short_id": r.short_id,
        "program_id": str(r.program_id),
        "researcher_id": str(r.researcher_id),
        "title": r.title,
        "severity": r.severity,
        "state": r.state,
        "bounty_cents": r.bounty_cents,
        "bounty_currency": r.bounty_currency,
    }


def _program_summary(p: Program) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "slug": p.slug,
        "name": p.name,
        "owner_org_id": str(p.owner_org_id),
        "visibility": p.visibility,
        "status": p.status,
        "currency": p.currency,
        "total_reports": p.total_reports,
        "total_payouts_cents": p.total_payouts_cents,
    }


class BountyServicer:
    async def GetReportSummary(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        report_id = request.get("report_id")
        if not report_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "report_id required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(select(Report).where(Report.id == report_id))
            report = result.scalar_one_or_none()
            if not report:
                await context.abort(grpc.StatusCode.NOT_FOUND, "report not found")
            return _report_summary(report)

    async def GetProgramSummary(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        slug = request.get("slug")
        if not slug:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "slug required")
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Program).where(Program.slug == slug)
            )
            program = result.scalar_one_or_none()
            if not program:
                await context.abort(grpc.StatusCode.NOT_FOUND, "program not found")
            return _program_summary(program)

    async def RecordPayout(
        self, request: dict[str, Any], context: grpc.aio.ServicerContext
    ) -> dict[str, Any]:
        """Called by payment-svc when a payout settles.

        Mirrors the side effect of consuming payment.events — useful when
        the caller wants synchronous confirmation rather than eventual.
        """
        payment_svc_payout_id = request.get("payment_svc_payout_id")
        provider_payout_id = request.get("provider_payout_id")
        new_state = request.get("state", "paid")
        if not payment_svc_payout_id:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "payment_svc_payout_id required"
            )
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Payout).where(
                    Payout.payment_svc_payout_id == payment_svc_payout_id
                )
            )
            payout = result.scalar_one_or_none()
            if not payout:
                await context.abort(grpc.StatusCode.NOT_FOUND, "payout not found")
            if new_state in ("paid", "failed", "canceled", "processing"):
                payout.state = new_state
            if provider_payout_id:
                payout.provider_payout_id = provider_payout_id
            await session.commit()
            return {"payout_id": str(payout.id), "state": payout.state}


def _build_handler(servicer: BountyServicer) -> grpc.GenericRpcHandler:
    service_name = "offcon.bounty.v1.BountyService"
    handlers = {
        "GetReportSummary": grpc.unary_unary_rpc_method_handler(
            servicer.GetReportSummary,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "GetProgramSummary": grpc.unary_unary_rpc_method_handler(
            servicer.GetProgramSummary,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
        "RecordPayout": grpc.unary_unary_rpc_method_handler(
            servicer.RecordPayout,
            request_deserializer=_deserialize,
            response_serializer=_serialize,
        ),
    }
    return grpc.method_handlers_generic_handler(service_name, handlers)


class BountyGRPCServer:
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
        server.add_generic_rpc_handlers((_build_handler(BountyServicer()),))
        if self._settings.grpc_enable_reflection:
            try:
                from grpc_reflection.v1alpha import reflection

                reflection.enable_server_reflection(
                    ("offcon.bounty.v1.BountyService", reflection.SERVICE_NAME),
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
