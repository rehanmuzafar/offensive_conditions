"""Typed errors + FastAPI handlers."""

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

    # Writeup-specific
    WRITEUP_NOT_FOUND = "WRITEUP_NOT_FOUND"
    COMMENT_NOT_FOUND = "COMMENT_NOT_FOUND"
    NOT_AUTHOR = "NOT_AUTHOR"
    NOT_MODERATOR = "NOT_MODERATOR"
    ALREADY_VOTED = "ALREADY_VOTED"
    ALREADY_BOOKMARKED = "ALREADY_BOOKMARKED"
    NOT_BOOKMARKED = "NOT_BOOKMARKED"
    ALREADY_PUBLISHED = "ALREADY_PUBLISHED"
    NOT_PENDING = "NOT_PENDING"
    SOLVE_REQUIRED_TO_READ = "SOLVE_REQUIRED_TO_READ"
    SLUG_TAKEN = "SLUG_TAKEN"
    INVALID_VOTE_DIRECTION = "INVALID_VOTE_DIRECTION"
    INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION"
    SELF_VOTE_FORBIDDEN = "SELF_VOTE_FORBIDDEN"
    SUBMIT_RATE_LIMIT = "SUBMIT_RATE_LIMIT"


_STATUS_MAP: dict[ErrorCode, int] = {
    ErrorCode.INTERNAL: 500,
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.VALIDATION: 400,
    ErrorCode.INVALID_VOTE_DIRECTION: 400,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_AUTHOR: 403,
    ErrorCode.NOT_MODERATOR: 403,
    ErrorCode.SELF_VOTE_FORBIDDEN: 403,
    ErrorCode.SOLVE_REQUIRED_TO_READ: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.WRITEUP_NOT_FOUND: 404,
    ErrorCode.COMMENT_NOT_FOUND: 404,
    ErrorCode.NOT_BOOKMARKED: 404,
    ErrorCode.CONFLICT: 409,
    ErrorCode.ALREADY_VOTED: 409,
    ErrorCode.ALREADY_BOOKMARKED: 409,
    ErrorCode.ALREADY_PUBLISHED: 409,
    ErrorCode.NOT_PENDING: 409,
    ErrorCode.SLUG_TAKEN: 409,
    ErrorCode.INVALID_STATUS_TRANSITION: 409,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.SUBMIT_RATE_LIMIT: 429,
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
    log.warning("app_error", code=exc.code, message=exc.message, path=request.url.path)
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
            "error": {"code": ErrorCode.INTERNAL.value, "message": "internal server error"}
        },
    )
