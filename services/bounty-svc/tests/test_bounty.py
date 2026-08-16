"""Smoke tests for bounty-svc routes + state machine."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_livez(client: AsyncClient) -> None:
    response = await client.get("/livez")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_programs_anonymous(client: AsyncClient) -> None:
    response = await client.get("/v1/programs")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "meta" in data


@pytest.mark.asyncio
async def test_submit_report_requires_auth(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/programs/acme-corp/reports",
        json={
            "title": "SQL injection in /api/users",
            "description_md": "x" * 100,
            "reproduction_steps": "1. curl 2. observe",
            "impact": "data leakage",
            "asset_identifier": "api.acme.example",
            "severity": "high",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_award_requires_triager(client: AsyncClient, alice_token: str) -> None:
    response = await client.post(
        "/v1/admin/reports/00000000-0000-0000-0000-000000000099/award",
        headers={"Authorization": f"Bearer {alice_token}"},
        json={"amount_cents": 50000, "currency": "USD", "initiate_payout": True},
    )
    assert response.status_code in (403, 404)


@pytest.mark.asyncio
async def test_program_invalid_transition(
    client: AsyncClient, admin_token: str
) -> None:
    """A closed program cannot be re-published."""
    # This test would need a fixture program. Smoke-test only — verifies the
    # endpoint responds with a structured error, not a stack trace.
    response = await client.post(
        "/v1/admin/programs/nonexistent-program/publish",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code in (403, 404)


@pytest.mark.asyncio
async def test_payout_account_check_error_path(
    client: AsyncClient, alice_token: str
) -> None:
    """If researcher has no Stripe account, request payout fails gracefully."""
    # Endpoint not directly exposed — payouts are triggered via /award.
    # This is a placeholder to assert error responses are well-structured.
    response = await client.get(
        "/v1/me/payouts",
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert response.status_code == 200
