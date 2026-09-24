"""Private object storage for report attachments.

Attachments are bug-bounty proof-of-concept material: someone else's exploit
code, screenshots of a live vulnerability, packet captures. They belong to the
reporter and the triage team and to nobody else, which drives two decisions
here.

The bucket carries no anonymous policy. A new MinIO bucket is private and that
is the correct end state — granting `s3:GetObject` to Principal `*` the way the
public media bucket does would put every proof-of-concept exploit on the
platform one guessed key away from the internet.

The bytes move through this service rather than through a presigned URL handed
to the browser. A presigned link outlives the authorization check that produced
it and can be forwarded to anyone; for this content that is the whole risk. It
is the same reason CTF writeups are streamed from `ctf-svc` instead of linked.
"""

from __future__ import annotations

from typing import IO, Iterator
from urllib.parse import urlsplit

from minio import Minio
from minio.error import S3Error

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("s3")

_CHUNK = 64 * 1024


class AttachmentStoreError(Exception):
    """Storage failed in a way the caller should surface rather than retry."""


def _host_port(endpoint: str) -> str:
    """MinIO wants `host:port`; the setting carries a full URL."""
    parts = urlsplit(endpoint if "//" in endpoint else f"//{endpoint}")
    return parts.netloc or parts.path


class AttachmentStore:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._bucket = settings.s3_bucket_attachments
        self._client = Minio(
            _host_port(settings.s3_endpoint),
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            secure=settings.s3_use_ssl,
            region=settings.s3_region,
        )

    def _ensure_bucket(self) -> None:
        if self._client.bucket_exists(self._bucket):
            return
        self._client.make_bucket(self._bucket, location=self._s.s3_region)
        # No set_bucket_policy call, deliberately. See the module docstring:
        # this bucket must stay private, and the way it stays private is that
        # nothing here ever makes it public.
        log.info("attachment_bucket_created", bucket=self._bucket, public=False)

    def put(self, *, key: str, data: IO[bytes], length: int, content_type: str) -> None:
        """Store an object. `data` is streamed, not buffered, so a large
        attachment does not have to fit in memory."""
        try:
            self._ensure_bucket()
            self._client.put_object(
                self._bucket,
                key,
                data,
                length=length,
                content_type=content_type,
            )
        except S3Error as exc:  # auth, connectivity, bucket state
            log.error("attachment_put_failed", key=key, error=str(exc))
            raise AttachmentStoreError(f"upload failed: {exc.code}") from exc
        log.info("attachment_stored", key=key, bytes=length)

    def stream(self, *, key: str) -> Iterator[bytes]:
        """Yield an object's bytes.

        The object is opened eagerly so a missing key or an auth failure raises
        here, while the caller can still turn it into an error response — not
        halfway through a 200 that has already sent its headers.
        """
        try:
            response = self._client.get_object(self._bucket, key)
        except S3Error as exc:
            log.error("attachment_get_failed", key=key, error=str(exc))
            raise AttachmentStoreError(f"download failed: {exc.code}") from exc

        def chunks() -> Iterator[bytes]:
            try:
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        return
                    yield chunk
            finally:
                response.close()
                response.release_conn()

        return chunks()
