"""Typed errors + FastAPI exception handlers."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

log = get_logger("errors")


class ErrorCode(StrEnum):
    INTERNAL = "INTERNAL_ERROR"
    BAD_REQUEST = "BAD_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    VALIDATION = "VALIDATION_FAILED"
    RATE_LIMITED = "RATE_LIMITED"

    # CTF-specific
    EVENT_NOT_FOUND = "EVENT_NOT_FOUND"
    EVENT_NOT_LIVE = "EVENT_NOT_LIVE"
    EVENT_NOT_REGISTRATION_OPEN = "EVENT_NOT_REGISTRATION_OPEN"
    EVENT_REGISTRATION_FULL = "EVENT_REGISTRATION_FULL"
    EVENT_INVITATION_REQUIRED = "EVENT_INVITATION_REQUIRED"
    EVENT_INVITATION_INVALID = "EVENT_INVITATION_INVALID"
    EVENT_ENDED = "EVENT_ENDED"
    EVENT_FROZEN = "EVENT_FROZEN"
    CHALLENGE_NOT_FOUND = "CHALLENGE_NOT_FOUND"
    CHALLENGE_LOCKED = "CHALLENGE_LOCKED"
    CHALLENGE_PREREQ_MISSING = "CHALLENGE_PREREQ_MISSING"
    ALREADY_REGISTERED = "ALREADY_REGISTERED"
    NOT_REGISTERED = "NOT_REGISTERED"
    NOT_ORGANIZER = "NOT_ORGANIZER"
    NOT_CAPTAIN = "NOT_CAPTAIN"
    ALREADY_SOLVED = "ALREADY_SOLVED"
    FLAG_INCORRECT = "FLAG_INCORRECT"
    PARTICIPANT_DISQUALIFIED = "PARTICIPANT_DISQUALIFIED"
    INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION"
    HINT_ALREADY_UNLOCKED = "HINT_ALREADY_UNLOCKED"
    HINT_NOT_FOUND = "HINT_NOT_FOUND"
    TEAM_SIZE_EXCEEDED = "TEAM_SIZE_EXCEEDED"


_STATUS_MAP: dict[ErrorCode, int] = {
    ErrorCode.INTERNAL: 500,
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.VALIDATION: 400,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_ORGANIZER: 403,
    ErrorCode.NOT_CAPTAIN: 403,
    ErrorCode.PARTICIPANT_DISQUALIFIED: 403,
    ErrorCode.EVENT_INVITATION_REQUIRED: 403,
    ErrorCode.EVENT_INVITATION_INVALID: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.EVENT_NOT_FOUND: 404,
    ErrorCode.CHALLENGE_NOT_FOUND: 404,
    ErrorCode.NOT_REGISTERED: 404,
    ErrorCode.HINT_NOT_FOUND: 404,
    ErrorCode.EVENT_NOT_LIVE: 409,
    ErrorCode.EVENT_NOT_REGISTRATION_OPEN: 409,
    ErrorCode.EVENT_REGISTRATION_FULL: 409,
    ErrorCode.EVENT_ENDED: 409,
    ErrorCode.EVENT_FROZEN: 409,
    ErrorCode.CHALLENGE_LOCKED: 409,
    ErrorCode.CHALLENGE_PREREQ_MISSING: 409,
    ErrorCode.CONFLICT: 409,
    ErrorCode.ALREADY_REGISTERED: 409,
    ErrorCode.ALREADY_SOLVED: 409,
    ErrorCode.FLAG_INCORRECT: 422,
    ErrorCode.INVALID_STATUS_TRANSITION: 409,
    ErrorCode.HINT_ALREADY_UNLOCKED: 409,
    ErrorCode.TEAM_SIZE_EXCEEDED: 409,
    ErrorCode.RATE_LIMITED: 429,
}


class AppError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code or _STATUS_MAP.get(code, 500)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code.value, "message": self.message}
        if self.details:
            out["details"] = self.details
        return out


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    log.warning(
        "app_error", code=exc.code, message=exc.message, path=request.url.path
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
    log.warning("validation_error", path=request.url.path, errors=_json_safe_errors(exc.errors()))
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": ErrorCode.VALIDATION.value,
                "message": "request validation failed",
                "details": {"errors": _json_safe_errors(exc.errors())},
            }
        },
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = ErrorCode.INTERNAL
    if exc.status_code == 401:
        code = ErrorCode.UNAUTHORIZED
    elif exc.status_code == 403:
        code = ErrorCode.FORBIDDEN
    elif exc.status_code == 404:
        code = ErrorCode.NOT_FOUND
    elif exc.status_code == 409:
        code = ErrorCode.CONFLICT
    elif 400 <= exc.status_code < 500:
        code = ErrorCode.BAD_REQUEST
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code.value, "message": str(exc.detail)}},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_exception", path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": ErrorCode.INTERNAL.value,
                "message": "internal server error",
            }
        },
    )
