"""Typed application errors + FastAPI handlers."""

from __future__ import annotations

from enum import Enum
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger


class ErrorCode(str, Enum):
    # Generic
    INTERNAL = "INTERNAL_ERROR"
    BAD_REQUEST = "BAD_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    VALIDATION = "VALIDATION_FAILED"
    RATE_LIMITED = "RATE_LIMITED"

    # Program
    PROGRAM_NOT_FOUND = "PROGRAM_NOT_FOUND"
    PROGRAM_NOT_PUBLISHED = "PROGRAM_NOT_PUBLISHED"
    PROGRAM_PAUSED = "PROGRAM_PAUSED"
    PROGRAM_CLOSED = "PROGRAM_CLOSED"
    PROGRAM_INVALID_STATE = "PROGRAM_INVALID_STATE"
    NOT_PROGRAM_OWNER = "NOT_PROGRAM_OWNER"

    # Report
    REPORT_NOT_FOUND = "REPORT_NOT_FOUND"
    REPORT_INVALID_STATE = "REPORT_INVALID_STATE"
    REPORT_NOT_AUTHOR = "REPORT_NOT_AUTHOR"
    REPORT_NOT_TRIAGER = "REPORT_NOT_TRIAGER"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"
    DUPLICATE_OF_SELF = "DUPLICATE_OF_SELF"

    # Payout
    PAYOUT_NOT_FOUND = "PAYOUT_NOT_FOUND"
    PAYOUT_ALREADY_REQUESTED = "PAYOUT_ALREADY_REQUESTED"
    PAYOUT_AMOUNT_EXCEEDS_CAP = "PAYOUT_AMOUNT_EXCEEDS_CAP"
    PAYOUT_ACCOUNT_MISSING = "PAYOUT_ACCOUNT_MISSING"
    PAYOUT_ACCOUNT_UNVERIFIED = "PAYOUT_ACCOUNT_UNVERIFIED"
    PAYMENT_SVC_ERROR = "PAYMENT_SVC_ERROR"

    # Attachment
    ATTACHMENT_NOT_FOUND = "ATTACHMENT_NOT_FOUND"
    ATTACHMENT_TOO_LARGE = "ATTACHMENT_TOO_LARGE"
    ATTACHMENT_TYPE_NOT_ALLOWED = "ATTACHMENT_TYPE_NOT_ALLOWED"


STATUS_MAP: dict[ErrorCode, int] = {
    ErrorCode.INTERNAL: 500,
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.VALIDATION: 400,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.PROGRAM_NOT_FOUND: 404,
    ErrorCode.REPORT_NOT_FOUND: 404,
    ErrorCode.PAYOUT_NOT_FOUND: 404,
    ErrorCode.ATTACHMENT_NOT_FOUND: 404,
    ErrorCode.CONFLICT: 409,
    ErrorCode.PROGRAM_NOT_PUBLISHED: 409,
    ErrorCode.PROGRAM_PAUSED: 409,
    ErrorCode.PROGRAM_CLOSED: 409,
    ErrorCode.PROGRAM_INVALID_STATE: 409,
    ErrorCode.REPORT_INVALID_STATE: 409,
    ErrorCode.PAYOUT_ALREADY_REQUESTED: 409,
    ErrorCode.DUPLICATE_OF_SELF: 409,
    ErrorCode.NOT_PROGRAM_OWNER: 403,
    ErrorCode.REPORT_NOT_AUTHOR: 403,
    ErrorCode.REPORT_NOT_TRIAGER: 403,
    ErrorCode.PAYOUT_ACCOUNT_UNVERIFIED: 403,
    ErrorCode.PAYOUT_ACCOUNT_MISSING: 422,
    ErrorCode.OUT_OF_SCOPE: 422,
    ErrorCode.PAYOUT_AMOUNT_EXCEEDS_CAP: 422,
    ErrorCode.ATTACHMENT_TOO_LARGE: 413,
    ErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED: 415,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.PAYMENT_SVC_ERROR: 502,
}


class AppError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = STATUS_MAP.get(code, 500)
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code.value, "message": self.message}
        if self.details:
            out["details"] = self.details
        return out


log = get_logger("errors")


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    log.warning(
        "app_error",
        code=exc.code.value,
        path=str(request.url.path),
        message=exc.message,
    )
    return JSONResponse(status_code=exc.status_code, content={"error": exc.to_dict()})


def _json_safe_errors(errors: list[Any]) -> list[dict[str, Any]]:
    """Make Pydantic v2 validation errors serializable.

    `exc.errors()` embeds the original exception object under `ctx` (and can put
    arbitrary objects in `input`). JSONResponse then dies with "Object of type
    ValueError is not JSON serializable", turning every 400 into a 500 and
    hiding the actual field error from the caller.
    """
    safe: list[dict[str, Any]] = []
    for err in errors:
        e = dict(err)
        ctx = e.get("ctx")
        if isinstance(ctx, dict):
            e["ctx"] = {
                k: v if isinstance(v, (str, int, float, bool, type(None))) else str(v)
                for k, v in ctx.items()
            }
        if "input" in e and not isinstance(
            e["input"], (str, int, float, bool, type(None), list, dict)
        ):
            e["input"] = str(e["input"])
        e.pop("url", None)
        safe.append(e)
    return safe


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    log.warning(
        "validation_error",
        path=str(request.url.path),
        errors=_json_safe_errors(exc.errors()),
    )
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": ErrorCode.VALIDATION.value,
                "message": "request validation failed",
                "details": {"issues": _json_safe_errors(exc.errors())},
            }
        },
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": ErrorCode.BAD_REQUEST.value
                if exc.status_code < 500
                else ErrorCode.INTERNAL.value,
                "message": str(exc.detail),
            }
        },
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_error", path=str(request.url.path))
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": ErrorCode.INTERNAL.value,
                "message": "internal server error",
            }
        },
    )
