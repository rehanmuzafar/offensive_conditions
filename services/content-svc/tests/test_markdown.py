"""Tests for markdown rendering + sanitization."""

from __future__ import annotations

from app.utils.markdown import excerpt, render_safe_html


def test_render_basic_markdown():
    md = "# Hello\n\nThis is **bold** and `code`."
    html = render_safe_html(md)
    assert "<h1" in html
    assert "<strong>bold</strong>" in html
    assert "<code>code</code>" in html


def test_render_strips_script_tag():
    md = 'Hello <script>alert("xss")</script> world'
    html = render_safe_html(md)
    assert "<script" not in html
    assert "alert" not in html or "&lt;script" in html


def test_render_strips_event_handlers():
    md = '<a href="javascript:alert(1)">click</a>'
    html = render_safe_html(md)
    assert "javascript:" not in html


def test_render_preserves_code_blocks():
    md = "```python\nprint('hello')\n```"
    html = render_safe_html(md)
    assert "<pre>" in html
    assert "<code" in html


def test_render_empty_input():
    assert render_safe_html("") == ""
    assert render_safe_html(None) == ""  # type: ignore[arg-type]


def test_excerpt_strips_markdown():
    md = "# Header\n\n**Bold** text with `code` and [a link](http://example.com)."
    out = excerpt(md, max_chars=200)
    assert "#" not in out
    assert "**" not in out
    assert "`" not in out


def test_excerpt_truncates_with_ellipsis():
    md = "word " * 100
    out = excerpt(md, max_chars=50)
    assert len(out) <= 50
    assert out.endswith("…")


def test_excerpt_drops_code_blocks():
    md = "Intro.\n\n```python\nsecret_code\n```\n\nOutro."
    out = excerpt(md)
    assert "secret_code" not in out
    assert "Intro" in out
    assert "Outro" in out
