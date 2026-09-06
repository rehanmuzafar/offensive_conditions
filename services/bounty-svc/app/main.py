"""FastAPI application factory."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.v1 import api_router
from app.core.auth import JWTValidator
from app.core.config import get_settings
from app.core.errors import (
    AppError,
    app_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_error_handler,
)
from app.core.logging import configure_logging, get_logger
from app.db.session import close_db, get_session_factory, init_db
from app.grpc.server import BountyGRPCServer
from app.services import (
    BountyEventPublisher,
    PaymentClient,
    PaymentEventConsumer,
    PayoutService,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    log = configure_logging(settings)
    log.info("starting_bounty_svc", env=settings.app_env, version=settings.app_version)

    init_db(settings)
    redis = Redis.from_url(settings.redis_url, decode_responses=False)
    app.state.redis = redis
    try:
        await redis.ping()
    except Exception:
        log.exception("redis_ping_failed")

    app.state.validator = JWTValidator(settings)
    app.state.payment_client = PaymentClient(settings)

    publisher = BountyEventPublisher(settings)
    try:
        await publisher.start()
    except Exception:
        log.exception("kafka_start_failed_continuing")
    app.state.publisher = publisher

    # Payment event consumer — wires payout state updates back into our DB
    async def _on_payout_sent(payload: dict[str, Any]) -> None:
        ps_payout_id = payload.get("payout_id") or payload.get("payment_svc_payout_id")
        provider_id = payload.get("provider_payout_id")
        if not ps_payout_id:
            return
        factory = get_session_factory()
        async with factory() as session:
            svc = PayoutService(session, settings, app.state.payment_client)
            await svc.mark_paid(
                payment_svc_payout_id=ps_payout_id, provider_payout_id=provider_id
            )
            await session.commit()

    async def _on_payout_failed(payload: dict[str, Any]) -> None:
        ps_payout_id = payload.get("payout_id") or payload.get("payment_svc_payout_id")
        reason = payload.get("failure_reason", "unspecified")
        if not ps_payout_id:
            return
        factory = get_session_factory()
        async with factory() as session:
            svc = PayoutService(session, settings, app.state.payment_client)
            await svc.mark_failed(
                payment_svc_payout_id=ps_payout_id, reason=str(reason)
            )
            await session.commit()

    consumer = PaymentEventConsumer(
        settings,
        on_payout_sent=_on_payout_sent,
        on_payout_failed=_on_payout_failed,
    )
    try:
        await consumer.start()
    except Exception:
        log.exception("payment_consumer_start_failed_continuing")
    app.state.payment_consumer = consumer

    grpc_server = BountyGRPCServer(settings)
    grpc_task: asyncio.Task[Any] | None = None
    try:
        await grpc_server.start()
        grpc_task = asyncio.create_task(grpc_server.wait_for_termination())
    except Exception:
        log.exception("grpc_start_failed_continuing")
    app.state.grpc_server = grpc_server

    app.state.version = settings.app_version
    app.state.settings = settings

    try:
        yield
    finally:
        log.info("shutting_down_bounty_svc")
        await consumer.stop()
        await publisher.stop()
        await app.state.payment_client.close()
        if grpc_task and not grpc_task.done():
            await grpc_server.stop()
            grpc_task.cancel()
            try:
                await grpc_task
            except (asyncio.CancelledError, Exception):
                pass
        await redis.aclose()
        await close_db()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Offensive Conditions — Bounty Service",
        version=settings.app_version,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.http_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    app.include_router(api_router)
    return app


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        import time
        import uuid

        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        log = get_logger("http")
        start = time.monotonic()
        response: Response | None = None
        try:
            response = await call_next(request)
        finally:
            dur_ms = int((time.monotonic() - start) * 1000)
            status_code = response.status_code if response else 500
            (log.warning if status_code >= 400 else log.info)(
                "http_request",
                method=request.method,
                path=request.url.path,
                status=status_code,
                duration_ms=dur_ms,
                request_id=rid,
            )
        assert response is not None
        response.headers["X-Request-ID"] = rid
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app = create_app()
