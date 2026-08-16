"""Slug generation: title → URL-safe slug."""

from __future__ import annotations

import re
import secrets
import unicodedata


_NON_ALPHANUM = re.compile(r"[^a-z0-9]+")


def slugify(text: str, *, max_length: int = 64) -> str:
    """Convert text to a URL-friendly slug.

    Strategy:
      1. NFKD-normalize to strip accents
      2. Lowercase
      3. Replace anything non-alphanumeric with '-'
      4. Collapse runs of '-' and trim trailing/leading '-'
      5. Truncate to max_length (without ending mid-word if possible)
    """
    if not text:
        return _random_suffix()
    norm = unicodedata.normalize("NFKD", text)
    norm = norm.encode("ascii", "ignore").decode("ascii")
    slug = _NON_ALPHANUM.sub("-", norm.lower()).strip("-")
    if not slug:
        return _random_suffix()
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip("-")
        # Try to end on word boundary
        last = slug.rfind("-")
        if last > max_length // 2:
            slug = slug[:last]
    return slug


def slugify_with_suffix(text: str, *, max_length: int = 64) -> str:
    """Slug with a random 6-char hex suffix, useful to dedupe in DB."""
    base = slugify(text, max_length=max_length - 7)
    return f"{base}-{_random_suffix()}"


def _random_suffix(n: int = 6) -> str:
    return secrets.token_hex(n // 2)
