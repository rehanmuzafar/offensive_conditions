"""Smoke tests for writeup HTTP endpoints."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_livez(app_client):
    resp = await app_client.get("/livez")
    assert resp.status_code == 200


async def test_list_writeups_anonymous(app_client):
    resp = await app_client.get("/v1/writeups")
    assert resp.status_code in (200, 503)


async def test_submit_writeup_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/writeups",
        json={
            "content_type": "machine",
            "content_id": "00000000-0000-0000-0000-000000000001",
            "title": "My Writeup",
            "content_markdown": "# Introduction\n\n" + "Lorem ipsum dolor sit amet, " * 10,
        },
    )
    assert resp.status_code == 401


async def test_vote_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/writeups/00000000-0000-0000-0000-000000000001/vote",
        json={"direction": "up"},
    )
    assert resp.status_code == 401


async def test_bookmark_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/writeups/00000000-0000-0000-0000-000000000001/bookmark"
    )
    assert resp.status_code == 401


async def test_publish_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/writeups/00000000-0000-0000-0000-000000000001/publish"
    )
    assert resp.status_code == 401


async def test_mod_queue_requires_auth(app_client):
    resp = await app_client.get("/v1/mod/writeups/pending")
    assert resp.status_code == 401


async def test_get_writeup_404(app_client):
    resp = await app_client.get(
        "/v1/writeups/00000000-0000-0000-0000-000000000000"
    )
    assert resp.status_code in (404, 503)
