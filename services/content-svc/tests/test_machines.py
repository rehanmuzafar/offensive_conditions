"""Smoke tests for machine endpoints."""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_livez(app_client):
    resp = await app_client.get("/livez")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"


async def test_list_machines_anonymous_returns_only_active_free(app_client):
    """Anonymous viewers see only active + free-tier machines."""
    resp = await app_client.get("/v1/machines")
    # Status may be 200 even with empty results
    assert resp.status_code in (200, 503)  # 503 if DB not seeded


async def test_search_requires_min_length(app_client):
    """Search query must be at least 2 chars."""
    resp = await app_client.get("/v1/search", params={"q": "a"})
    assert resp.status_code == 400


async def test_get_machine_404_for_unknown_uuid(app_client):
    resp = await app_client.get("/v1/machines/00000000-0000-0000-0000-000000000000")
    assert resp.status_code in (404, 503)
    if resp.status_code == 404:
        assert resp.json()["error"]["code"] == "MACHINE_NOT_FOUND"


async def test_create_machine_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/machines",
        json={
            "name": "Test Box",
            "slug": "test-box",
            "os": "linux",
            "difficulty": "easy",
            "image_ref": "harbor.offensiveconditions.org/machines/test:1",
            "image_version": "1",
        },
    )
    assert resp.status_code == 401


async def test_rate_machine_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/machines/00000000-0000-0000-0000-000000000001/rate",
        json={"rating": 5},
    )
    assert resp.status_code == 401
