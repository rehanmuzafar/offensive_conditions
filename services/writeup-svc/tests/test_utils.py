"""Unit tests for slug + markdown utilities."""

from __future__ import annotations

import pytest

from app.utils.markdown import excerpt, render_safe_html
from app.utils.slug import slugify, slugify_with_suffix


def test_slugify_basic():
    assert slugify("Hello World") == "hello-world"


def test_slugify_strips_punctuation():
    assert slugify("Hello, world! How are you?") == "hello-world-how-are-you"


def test_slugify_handles_unicode():
    # Accent stripped via NFKD
    assert slugify("café") == "cafe"


def test_slugify_collapses_runs():
    assert slugify("foo---bar___baz") == "foo-bar-baz"


def test_slugify_max_length():
    s = slugify("a" * 100, max_length=20)
    assert len(s) <= 20


def test_slugify_empty_returns_random():
    s = slugify("")
    assert len(s) == 6


def test_slugify_with_suffix_distinct():
    a = slugify_with_suffix("Hello")
    b = slugify_with_suffix("Hello")
    assert a != b


def test_render_safe_html_strips_script():
    out = render_safe_html('Hi <script>alert(1)</script>')
    assert "<script" not in out


def test_render_safe_html_keeps_code():
    out = render_safe_html("```python\nprint('hi')\n```")
    assert "<pre>" in out
    assert "<code" in out


def test_excerpt_strips_markdown():
    out = excerpt("# Title\n\n**bold** _italic_ `code`")
    assert "#" not in out
    assert "**" not in out
    assert "`" not in out
