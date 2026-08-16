"""Smoke tests for events HTTP endpoints."""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_livez(app_client):
    resp = await app_client.get("/livez")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_list_events_anonymous(app_client):
    resp = await app_client.get("/v1/events")
    assert resp.status_code in (200, 503)


async def test_get_event_404(app_client):
    resp = await app_client.get("/v1/events/00000000-0000-0000-0000-000000000000")
    assert resp.status_code in (404, 503)


async def test_create_event_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/events",
        json={
            "slug": "test-event",
            "name": "Test",
            "format": "jeopardy",
            "registration_starts_at": "2030-01-01T00:00:00Z",
            "registration_ends_at": "2030-01-02T00:00:00Z",
            "starts_at": "2030-01-02T00:00:00Z",
            "ends_at": "2030-01-03T00:00:00Z",
        },
    )
    assert resp.status_code == 401


async def test_register_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/events/00000000-0000-0000-0000-000000000001/register",
        json={},
    )
    assert resp.status_code == 401


async def test_submit_flag_requires_auth(app_client):
    resp = await app_client.post(
        "/v1/events/00000000-0000-0000-0000-000000000001/challenges/00000000-0000-0000-0000-000000000002/submit",
        json={"flag": "OFFCON{test}"},
    )
    assert resp.status_code == 401
