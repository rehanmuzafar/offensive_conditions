"""S3 / MinIO client for attachment uploads via presigned URLs."""

from __future__ import annotations

import hmac
import hashlib
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("s3")


class S3Client:
    """Minimal S3 client — just generates presigned POSTs without a SDK dep.

    Production deployments should swap this for the official boto3 / aioboto3
    client for full retry + multipart support. This implementation is
    intentionally lean so the service works in environments where boto3 isn't
    installable (sandbox, restricted CI).
    """

    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def generate_presigned_post(
        self,
        *,
        key: str,
        content_type: str,
        byte_size: int,
        expires_in_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Generate POST policy + form fields for a direct browser upload.

        Returns a dict with `url` and `fields`. The browser POSTs a multipart
        form to `url` with `fields` plus the file as `file`.

        Production: use boto3 `generate_presigned_post` for full POST policy.
        Here we emit a placeholder shape with the right structure so callers
        can be wired up; the actual signing is replaced when boto3 is added.
        """
        ttl = expires_in_seconds or self._s.s3_presigned_ttl_seconds
        expires_at = datetime.now(timezone.utc).timestamp() + ttl
        url = f"{self._s.s3_endpoint}/{self._s.s3_bucket_attachments}"

        # Fields a real S3 POST policy would set
        fields = {
            "key": key,
            "Content-Type": content_type,
            "x-amz-meta-byte-size": str(byte_size),
            "x-amz-meta-expires": str(int(expires_at)),
            # Placeholder signature — replace with real boto3 output in prod
            "policy": _b64_policy(key, byte_size, content_type, ttl),
            "x-amz-signature": _placeholder_signature(self._s.s3_secret_key, key),
            "x-amz-credential": f"{self._s.s3_access_key}/dev",
            "x-amz-algorithm": "AWS4-HMAC-SHA256",
            "x-amz-date": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        }
        return {"url": url, "fields": fields, "expires_at": expires_at}

    def generate_presigned_get(self, *, key: str, expires_in_seconds: int | None = None) -> str:
        ttl = expires_in_seconds or self._s.s3_presigned_ttl_seconds
        # Placeholder: real implementation uses SigV4
        return (
            f"{self._s.s3_endpoint}/{self._s.s3_bucket_attachments}/{quote(key)}"
            f"?X-Amz-Expires={ttl}"
        )


def _b64_policy(key: str, byte_size: int, content_type: str, ttl: int) -> str:
    """Return a placeholder base64-encoded policy. Real impl uses SigV4."""
    import base64
    import json

    expiry = datetime.now(timezone.utc).timestamp() + ttl
    policy = {
        "expiration": datetime.utcfromtimestamp(expiry).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "conditions": [
            {"key": key},
            {"Content-Type": content_type},
            ["content-length-range", 1, byte_size],
        ],
    }
    return base64.b64encode(json.dumps(policy).encode("utf-8")).decode("ascii")


def _placeholder_signature(secret: str, key: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), key.encode("utf-8"), hashlib.sha256
    ).hexdigest()
