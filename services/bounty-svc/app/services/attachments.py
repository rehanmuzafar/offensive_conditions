"""Attachment upload + management."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Report, ReportAttachment
from app.schemas import AttachmentUploadRequest
from app.services.s3 import S3Client

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
        self._s3 = S3Client(settings)

    async def request_upload(
        self,
        report_id: UUID,
        *,
        uploader_id: UUID,
        is_program_member: bool,
        data: AttachmentUploadRequest,
    ) -> tuple[ReportAttachment, dict]:
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
        if data.content_type not in _ALLOWED_CONTENT_TYPES:
            raise AppError(
                ErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
                f"content type {data.content_type} is not allowed",
            )
        max_bytes = self._settings.limit_attachment_max_mb * 1024 * 1024
        if data.byte_size > max_bytes:
            raise AppError(
                ErrorCode.ATTACHMENT_TOO_LARGE,
                f"attachment exceeds {self._settings.limit_attachment_max_mb} MB limit",
            )

        # Generate S3 key
        attachment_id = uuid4()
        safe_name = _safe_filename(data.filename)
        s3_key = f"reports/{report.id}/{attachment_id}/{safe_name}"

        # Create DB row in 'pending' (virus_scanned=false)
        attachment = ReportAttachment(
            id=attachment_id,
            report_id=report.id,
            uploader_id=uploader_id,
            filename=safe_name,
            content_type=data.content_type,
            byte_size=data.byte_size,
            s3_key=s3_key,
            virus_scanned=False,
        )
        self.session.add(attachment)
        await self.session.flush()

        presigned = self._s3.generate_presigned_post(
            key=s3_key,
            content_type=data.content_type,
            byte_size=data.byte_size,
        )
        log.info(
            "attachment_upload_requested",
            attachment_id=str(attachment_id),
            report_id=str(report.id),
            uploader=str(uploader_id),
            filename=safe_name,
            byte_size=data.byte_size,
        )
        return attachment, presigned

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

    async def get_download_url(
        self, attachment_id: UUID, *, viewer_id: UUID, is_program_member: bool
    ) -> str:
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
        return self._s3.generate_presigned_get(key=attachment.s3_key)

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
