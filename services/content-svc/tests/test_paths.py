"""Smoke tests for learning path endpoints."""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_list_paths_no_auth(app_client):
    resp = await app_client.get("/v1/paths")
    assert resp.status_code in (200, 503)


async def test_enroll_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/paths/00000000-0000-0000-0000-000000000001/enroll"
    )
    assert resp.status_code == 401


async def test_progress_requires_auth(app_client):
    resp = await app_client.get(
        "/v1/paths/00000000-0000-0000-0000-000000000001/progress"
    )
    assert resp.status_code == 401


async def test_complete_module_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/paths/00000000-0000-0000-0000-000000000001/modules/00000000-0000-0000-0000-000000000002/complete",
        json={"answers": {}},
    )
    assert resp.status_code == 401


async def test_my_enrollments_requires_auth(app_client):
    resp = await app_client.get("/v1/paths/me/enrolled")
    assert resp.status_code == 401
