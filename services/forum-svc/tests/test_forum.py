"""Smoke tests for forum HTTP endpoints."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_livez(app_client):
    resp = await app_client.get("/livez")
    assert resp.status_code == 200


async def test_list_categories_anonymous(app_client):
    resp = await app_client.get("/v1/categories")
    assert resp.status_code in (200, 503)


async def test_list_threads_anonymous(app_client):
    resp = await app_client.get("/v1/threads")
    assert resp.status_code in (200, 503)


async def test_create_thread_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/threads",
        json={
            "category_id": "00000000-0000-0000-0000-000000000001",
            "title": "Test",
            "body_markdown": "Hello",
        },
    )
    assert resp.status_code == 401


async def test_vote_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/posts/00000000-0000-0000-0000-000000000001/vote",
        json={"direction": "up"},
    )
    assert resp.status_code == 401


async def test_subscribe_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/threads/00000000-0000-0000-0000-000000000001/subscribe"
    )
    assert resp.status_code == 401


async def test_get_thread_404(app_client):
    resp = await app_client.get("/v1/threads/00000000-0000-0000-0000-000000000000")
    assert resp.status_code in (404, 503)
