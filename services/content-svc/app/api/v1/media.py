"""Banner upload endpoint (admin / content-creator only)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import get_claims
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.core.config import get_settings
from app.services.media import MediaError, MediaService

router = APIRouter(prefix="/media", tags=["media"])

_service: MediaService | None = None


def get_media_service() -> MediaService:
    global _service
    if _service is None:
        _service = MediaService(get_settings())
    return _service


@router.post("/banner", status_code=status.HTTP_201_CREATED)
async def upload_banner(
    file: Annotated[UploadFile, File(description="PNG/JPEG/WebP/GIF/SVG, max 5 MB")],
    kind: Annotated[str, Form(description="ctf | machine | path | dojo | pro_lab")] = "misc",
    claims: Claims = Depends(get_claims),
    svc: MediaService = Depends(get_media_service),
) -> dict[str, str]:
    """Upload a banner and return its URL.

    The caller stores the returned `url` on the entity's cover_image_url; this
    endpoint deliberately does not write to any table so one upload path can
    serve CTF events, machines, paths, dojos and pro labs alike.
    """
    if not claims.is_content_creator:
        raise AppError(ErrorCode.FORBIDDEN, "admin or content_creator role required")

    data = await file.read()
    try:
        url = svc.upload_banner(
            data=data,
            content_type=file.content_type or "",
            kind=kind,
            filename=file.filename or "",
        )
    except MediaError as exc:
        raise AppError(ErrorCode.VALIDATION, str(exc)) from exc

    return {"url": url, "kind": kind, "content_type": file.content_type or "", "bytes": str(len(data))}


# Team and profile avatars: any signed-in player uploads these for something
# they own, so unlike banners this is not gated on the content_creator role.
# The tighter size cap is the trade for opening it up.
AVATAR_MAX_BYTES = 2 * 1024 * 1024


@router.post("/avatar", status_code=status.HTTP_201_CREATED)
async def upload_avatar(
    file: Annotated[UploadFile, File(description="PNG/JPEG/WebP, max 2 MB")],
    claims: Claims = Depends(get_claims),
    svc: MediaService = Depends(get_media_service),
) -> dict[str, str]:
    """Upload an avatar image and return its URL.

    Like the banner route, this writes no table — the caller stores the returned
    `url` on whatever it owns (a team's avatar_url, a profile's).
    """
    data = await file.read()
    if len(data) > AVATAR_MAX_BYTES:
        raise AppError(
            ErrorCode.VALIDATION,
            f"image is {len(data)} bytes; the limit is {AVATAR_MAX_BYTES}",
        )
    # SVG is allowed for banners but not here: avatars render inside other
    # players' pages, and an SVG can carry script.
    if file.content_type == "image/svg+xml":
        raise AppError(ErrorCode.VALIDATION, "SVG avatars are not allowed; use PNG, JPEG or WebP")

    try:
        url = svc.upload_banner(
            data=data,
            content_type=file.content_type or "",
            kind="avatar",
            filename=file.filename or "",
        )
    except MediaError as exc:
        raise AppError(ErrorCode.VALIDATION, str(exc)) from exc

    return {"url": url}
