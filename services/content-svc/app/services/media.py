"""Banner / cover image uploads to MinIO (S3-compatible).

Every catalog entity already carries a `cover_image_url`, but nothing could put
an image there — bounty-svc's S3 helper only emits placeholder signatures and
never talks to MinIO. This uses the `minio` SDK (already a dependency) to do a
real upload and returns a URL the admin UI can store on the entity.
"""

from __future__ import annotations

import io
import json
import uuid
from datetime import timedelta

from minio import Minio
from minio.error import S3Error

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("media")

# Bitmap + vector formats a browser can render in an <img>.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


class MediaError(Exception):
    """Raised for caller-fixable upload problems (bad type, too large)."""


class MediaService:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._bucket = settings.storage_media_bucket
        self._client = Minio(
            settings.storage_endpoint,
            access_key=settings.storage_access_key.get_secret_value(),
            secret_key=settings.storage_secret_key.get_secret_value(),
            secure=settings.storage_use_ssl,
            region=settings.storage_region,
        )

    def _ensure_bucket(self) -> None:
        if self._client.bucket_exists(self._bucket):
            return
        self._client.make_bucket(self._bucket, location=self._s.storage_region)
        # Banners are public content shown to every visitor, so the prefix is
        # world-readable. This also lets us hand out stable URLs instead of
        # presigned ones, which would expire and leave broken images behind.
        policy = json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{self._bucket}/banners/*"],
                    }
                ],
            }
        )
        self._client.set_bucket_policy(self._bucket, policy)
        log.info("media_bucket_created", bucket=self._bucket)

    def upload_banner(
        self, *, data: bytes, content_type: str, kind: str, filename: str = ""
    ) -> str:
        """Store an image and return the URL to persist on the entity.

        `kind` groups objects by what they belong to (ctf, machine, path, …) so
        the bucket stays browsable.
        """
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise MediaError(
                f"unsupported content type {content_type!r}; "
                f"allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            )
        if not data:
            raise MediaError("empty file")
        if len(data) > MAX_BYTES:
            raise MediaError(f"file is {len(data)} bytes; limit is {MAX_BYTES}")

        ext = ALLOWED_CONTENT_TYPES[content_type]
        safe_kind = "".join(c for c in kind if c.isalnum() or c in "-_") or "misc"
        key = f"banners/{safe_kind}/{uuid.uuid4().hex}.{ext}"

        try:
            self._ensure_bucket()
            self._client.put_object(
                self._bucket,
                key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
            )
        except S3Error as exc:  # bucket policy, auth, connectivity
            log.error("media_upload_failed", key=key, error=str(exc))
            raise MediaError(f"upload failed: {exc.code}") from exc

        log.info("media_uploaded", key=key, bytes=len(data), kind=safe_kind)
        return self.url_for(key)

    def url_for(self, key: str) -> str:
        """Stable public URL for an object.

        The URL is persisted on the entity, so it must not expire and must be
        resolvable by a browser — the internal `minio:9000` host is not, since
        that name only exists inside the Docker network. Configure
        STORAGE_PUBLIC_BASE_URL (or a CDN) with the address users reach.
        """
        base = self._s.storage_cdn_base_url or getattr(self._s, "storage_public_base_url", "")
        if base:
            return f"{base.rstrip('/')}/{self._bucket}/{key}"
        # Last resort: a presigned URL still renders, but it expires — surface
        # that rather than silently writing a link that dies in a week.
        log.warning("media_public_base_url_unset", bucket=self._bucket, key=key)
        return self._client.presigned_get_object(
            self._bucket, key, expires=timedelta(days=7)
        )
