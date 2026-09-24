"""Attachment upload + management."""

from __future__ import annotations

import re
from typing import IO, Iterator
from uuid import UUID, uuid4

import anyio.to_thread
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Report, ReportAttachment
from app.services.s3 import AttachmentStore, AttachmentStoreError

log = get_logger("attachments")

# Conservative content-type allowlist for bug bounty proof-of-concept uploads.
_ALLOWED_CONTENT_TYPES = {
    # Documents
    "application/pdf",
    "text/plain",
    "text/markdown",
    # Images
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    # Archives (proof-of-concept payloads)
    "application/zip",
    "application/x-7z-compressed",
    "application/x-tar",
    # Video screencast
    "video/mp4",
    "video/webm",
    # Logs / pcap
    "application/octet-stream",
    "application/vnd.tcpdump.pcap",
    "application/x-pcap",
}

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._\-]+")


def _safe_filename(name: str) -> str:
    return _FILENAME_SAFE.sub("_", name)[:200]


class AttachmentService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self._settings = settings
        self._store = AttachmentStore(settings)

    async def store_upload(
        self,
        report_id: UUID,
        *,
        uploader_id: UUID,
        is_program_member: bool,
        filename: str,
        content_type: str,
        data: IO[bytes],
        byte_size: int,
    ) -> ReportAttachment:
        """Take the uploaded bytes, store them, and record the attachment.

        `byte_size` is measured from the body we actually received. The old
        flow took the client's word for it and handed back an upload URL, so
        the size limit was advisory — the browser talked to storage directly
        and could write whatever it liked under whatever key it was given.
        """
        # Validate report exists + caller is researcher or triager
        report_result = await self.session.execute(
            select(Report).where(Report.id == report_id)
        )
        report = report_result.scalar_one_or_none()
        if not report:
            raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
        if (
            not is_program_member
            and report.researcher_id != uploader_id
        ):
            raise AppError(ErrorCode.FORBIDDEN, "only the researcher or program staff can attach")

        # Validate content-type + size
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise AppError(
                ErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
                f"content type {content_type} is not allowed",
            )
        if byte_size <= 0:
            raise AppError(ErrorCode.VALIDATION, "attachment is empty")
        max_bytes = self._settings.limit_attachment_max_mb * 1024 * 1024
        if byte_size > max_bytes:
            raise AppError(
                ErrorCode.ATTACHMENT_TOO_LARGE,
                f"attachment exceeds {self._settings.limit_attachment_max_mb} MB limit",
            )

        attachment_id = uuid4()
        safe_name = _safe_filename(filename)
        s3_key = f"reports/{report.id}/{attachment_id}/{safe_name}"

        # Store first: a failed upload should leave no row pointing at an
        # object that was never written. MinIO's client is blocking, so it goes
        # to a worker thread rather than stalling the event loop for the
        # duration of the transfer.
        try:
            await anyio.to_thread.run_sync(
                lambda: self._store.put(
                    key=s3_key,
                    data=data,
                    length=byte_size,
                    content_type=content_type,
                )
            )
        except AttachmentStoreError as exc:
            log.error(
                "attachment_upload_failed",
                report_id=str(report.id),
                uploader=str(uploader_id),
                error=str(exc),
            )
            raise AppError(ErrorCode.INTERNAL, "could not store attachment") from exc

        # virus_scanned stays false: no scanner runs yet, and download refuses
        # anything a scanner has actively failed. See the download path.
        attachment = ReportAttachment(
            id=attachment_id,
            report_id=report.id,
            uploader_id=uploader_id,
            filename=safe_name,
            content_type=content_type,
            byte_size=byte_size,
            s3_key=s3_key,
            virus_scanned=False,
        )
        self.session.add(attachment)
        await self.session.flush()

        log.info(
            "attachment_uploaded",
            attachment_id=str(attachment_id),
            report_id=str(report.id),
            uploader=str(uploader_id),
            filename=safe_name,
            byte_size=byte_size,
        )
        return attachment

    async def list_for_report(self, report_id: UUID) -> list[ReportAttachment]:
        result = await self.session.execute(
            select(ReportAttachment)
            .where(
                ReportAttachment.report_id == report_id,
                ReportAttachment.deleted_at.is_(None),
            )
            .order_by(ReportAttachment.created_at.asc())
        )
        return list(result.scalars().all())

    async def open_for_download(
        self, attachment_id: UUID, *, viewer_id: UUID, is_program_member: bool
    ) -> tuple[ReportAttachment, Iterator[bytes]]:
        """Authorize the viewer, then open the object for streaming.

        The check and the bytes stay in the same request on purpose. Returning
        a presigned URL instead would mean the link, once issued, keeps working
        for whoever holds it after the viewer's access is gone.
        """
        result = await self.session.execute(
            select(ReportAttachment, Report)
            .join(Report, Report.id == ReportAttachment.report_id)
            .where(ReportAttachment.id == attachment_id)
        )
        row = result.one_or_none()
        if not row:
            raise AppError(ErrorCode.ATTACHMENT_NOT_FOUND, "attachment not found")
        attachment, report = row
        if attachment.deleted_at is not None:
            raise AppError(ErrorCode.ATTACHMENT_NOT_FOUND, "attachment removed")
        if not is_program_member and report.researcher_id != viewer_id:
            raise AppError(ErrorCode.FORBIDDEN, "no access to this attachment")
        if attachment.virus_scanned and attachment.virus_clean is False:
            raise AppError(
                ErrorCode.FORBIDDEN,
                "attachment failed virus scan and is quarantined",
            )

        try:
            stream = await anyio.to_thread.run_sync(
                lambda: self._store.stream(key=attachment.s3_key)
            )
        except AttachmentStoreError as exc:
            log.error(
                "attachment_download_failed",
                attachment_id=str(attachment_id),
                error=str(exc),
            )
            raise AppError(ErrorCode.ATTACHMENT_NOT_FOUND, "attachment is unavailable") from exc

        log.info(
            "attachment_downloaded",
            attachment_id=str(attachment_id),
            viewer=str(viewer_id),
            staff=is_program_member,
        )
        return attachment, stream

    async def mark_virus_scan_result(
        self,
        attachment_id: UUID,
        *,
        sha256: str | None,
        is_clean: bool,
    ) -> None:
        """Called by the async virus-scan worker after AV finishes."""
        result = await self.session.execute(
            select(ReportAttachment).where(ReportAttachment.id == attachment_id)
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            return
        attachment.virus_scanned = True
        attachment.virus_clean = is_clean
        attachment.sha256 = sha256
        await self.session.flush()
        log.info(
            "attachment_virus_scan_done",
            attachment_id=str(attachment_id),
            clean=is_clean,
        )
