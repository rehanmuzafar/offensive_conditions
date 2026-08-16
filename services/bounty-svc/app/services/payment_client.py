"""Lightweight gRPC client for payment-svc (JSON-over-gRPC).

Mirrors the JSON wire format used across our internal services. Used to
request Stripe Connect payouts from bounty-svc.
"""

from __future__ import annotations

import json
from typing import Any

import grpc

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger

log = get_logger("payment-client")


def _serialize(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def _deserialize(data: bytes) -> Any:
    return json.loads(data.decode("utf-8")) if data else {}


class PaymentClient:
    """Lazy async gRPC client for payment-svc."""

    def __init__(self, settings: Settings) -> None:
        self._addr = settings.payment_svc_addr
        self._channel: grpc.aio.Channel | None = None

    async def _ensure_channel(self) -> grpc.aio.Channel:
        if self._channel is None:
            self._channel = grpc.aio.insecure_channel(
                self._addr,
                options=[
                    ("grpc.keepalive_time_ms", 30_000),
                    ("grpc.keepalive_timeout_ms", 10_000),
                    ("grpc.max_receive_message_length", 8 * 1024 * 1024),
                ],
            )
        return self._channel

    async def close(self) -> None:
        if self._channel is not None:
            await self._channel.close()
            self._channel = None

    async def request_bounty_payout(
        self,
        *,
        researcher_id: str,
        amount_cents: int,
        currency: str,
        report_id: str,
        idempotency_key: str,
    ) -> dict:
        """Request a payout via payment-svc.

        Returns the payment-svc payout descriptor with at least `payout_id`
        and `state`. Raises AppError(PAYMENT_SVC_ERROR) on failure.
        """
        channel = await self._ensure_channel()
        method = "/offcon.payment.v1.PaymentService/RequestBountyPayout"
        try:
            response = await channel.unary_unary(
                method,
                request_serializer=_serialize,
                response_deserializer=_deserialize,
            )(
                {
                    "researcher_id": researcher_id,
                    "amount_cents": amount_cents,
                    "currency": currency,
                    "report_id": report_id,
                    "idempotency_key": idempotency_key,
                },
                timeout=10.0,
            )
            return dict(response)
        except grpc.aio.AioRpcError as exc:
            log.warning(
                "payment_svc_grpc_error",
                code=exc.code().name if exc.code() else "UNKNOWN",
                detail=exc.details(),
            )
            raise AppError(
                ErrorCode.PAYMENT_SVC_ERROR,
                f"payment service error: {exc.details() or exc.code().name}",
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("payment_svc_unknown_error")
            raise AppError(
                ErrorCode.PAYMENT_SVC_ERROR, f"payment service error: {exc}"
            )

    async def check_payout_account(self, *, user_id: str) -> dict:
        """Ask payment-svc whether the user has a verified Stripe Connect account.

        Returns at least `{verified: bool, can_receive_payouts: bool}`.
        """
        channel = await self._ensure_channel()
        method = "/offcon.payment.v1.PaymentService/GetPayoutAccount"
        try:
            response = await channel.unary_unary(
                method,
                request_serializer=_serialize,
                response_deserializer=_deserialize,
            )({"user_id": user_id}, timeout=5.0)
            return dict(response)
        except grpc.aio.AioRpcError as exc:
            # Treat NOT_FOUND as a normal "no account" answer, not an error
            if exc.code() == grpc.StatusCode.NOT_FOUND:
                return {"verified": False, "can_receive_payouts": False}
            raise AppError(
                ErrorCode.PAYMENT_SVC_ERROR,
                f"payment service error: {exc.details() or exc.code().name}",
            )
