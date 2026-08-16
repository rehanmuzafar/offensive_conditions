"""Safe markdown → HTML rendering using markdown-it-py + bleach sanitization."""

from __future__ import annotations

from functools import lru_cache

import bleach
from markdown_it import MarkdownIt

# Tags + attributes a writeup author legitimately needs. Anything else gets stripped.
ALLOWED_TAGS = [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "code", "pre", "blockquote",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "kbd", "sup", "sub", "mark",
    "details", "summary",
    "div", "span",  # allowed but stripped of class/style
]

ALLOWED_ATTRS = {
    "*": ["id"],
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "code": ["class"],  # for language-* highlighting
    "pre": ["class"],
    "th": ["align", "colspan", "rowspan"],
    "td": ["align", "colspan", "rowspan"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


@lru_cache(maxsize=1)
def _md() -> MarkdownIt:
    return (
        MarkdownIt("commonmark", {"linkify": True, "typographer": True, "html": False})
        .enable(["table", "strikethrough"])
    )


def render_safe_html(markdown_text: str) -> str:
    """Render markdown and sanitize. Returns safe-to-serve HTML."""
    if not markdown_text:
        return ""
    rendered = _md().render(markdown_text)
    cleaned = bleach.clean(
        rendered,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    return bleach.linkify(cleaned, callbacks=[bleach.callbacks.nofollow])


def excerpt(markdown_text: str, max_chars: int = 280) -> str:
    """Plain-text excerpt for list views (no HTML)."""
    if not markdown_text:
        return ""
    # Drop fenced code blocks
    lines: list[str] = []
    in_fence = False
    for line in markdown_text.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        lines.append(line)
    text = " ".join(lines).strip()
    # Strip basic markdown formatting characters
    for ch in ("**", "*", "_", "`", "#", ">"):
        text = text.replace(ch, "")
    text = " ".join(text.split())
    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "…"
    return text
