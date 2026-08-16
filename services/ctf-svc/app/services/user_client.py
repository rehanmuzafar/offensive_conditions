"""Thin HTTP client for user-svc.

ctf-svc must not take a team's identity on trust from the browser. Team
registration previously accepted whatever `team_id` the client sent, stubbed the
name as "team-<uuid>" and hard-coded `member_count = 1` — so anyone could
register anyone else's team, and `max_team_size` was unenforceable.

This asks user-svc, forwarding the caller's own bearer token so user-svc applies
its own authorisation rather than ctf-svc inventing an answer.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger

log = get_logger("user_client")

# Roles allowed to enter a team into an event.
CAPTAIN_ROLES = {"owner", "captain"}


class UserServiceClient:
    def __init__(self, settings: Settings) -> None:
        self._base = self._http_base(settings)
        self._timeout = 8.0

    @staticmethod
    def _http_base(settings: Settings) -> str:
        """user_svc_addr is configured for gRPC (host:9001); the REST port is 8012."""
        addr = getattr(settings, "user_svc_addr", "user-svc:9001") or "user-svc:9001"
        host = addr.split(":")[0]
        return f"http://{host}:8012"

    async def get_team_for_registration(
        self, team_id: UUID, *, bearer: str, actor_id: UUID
    ) -> tuple[str, int]:
        """Return (team_name, member_count) after checking the caller may register it.

        Raises AppError if the team is unreadable or the caller is not one of its
        captains.
        """
        headers = {"Authorization": bearer}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                team_res = await client.get(f"{self._base}/v1/teams/{team_id}", headers=headers)
                members_res = await client.get(
                    f"{self._base}/v1/teams/{team_id}/members", headers=headers
                )
            except httpx.HTTPError as exc:
                log.error("user_svc_unreachable", error=str(exc))
                raise AppError(
                    ErrorCode.INTERNAL, "could not verify the team right now"
                ) from exc

        if team_res.status_code == 404:
            raise AppError(ErrorCode.VALIDATION, "team not found")
        if team_res.status_code >= 400 or members_res.status_code >= 400:
            log.warning(
                "user_svc_rejected",
                team_status=team_res.status_code,
                members_status=members_res.status_code,
            )
            raise AppError(ErrorCode.FORBIDDEN, "you cannot register this team")

        # user-svc wraps both payloads: {"team": {...}} and {"members": [...]}.
        team_body: dict[str, Any] = team_res.json()
        team: dict[str, Any] = team_body.get("team") or team_body
        members = members_res.json().get("members") or []

        actor = str(actor_id)
        mine = next((m for m in members if str(m.get("user_id")) == actor), None)
        if mine is None:
            raise AppError(ErrorCode.FORBIDDEN, "you are not a member of this team")
        if str(mine.get("role", "")).lower() not in CAPTAIN_ROLES:
            raise AppError(
                ErrorCode.FORBIDDEN, "only the team owner or a captain can register the team"
            )

        name = team.get("name") or f"team-{team_id}"
        return name, len(members)

    async def list_my_team_ids(self, *, bearer: str) -> list[str]:
        """Team ids the caller belongs to, as user-svc sees them.

        Team events store one participant row per team, so this is how a member
        is recognised as taking part at all.
        """
        if not bearer:
            return []
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                res = await client.get(
                    f"{self._base}/v1/teams/me", headers={"Authorization": bearer}
                )
            except httpx.HTTPError as exc:
                log.warning("user_svc_teams_unreachable", error=str(exc))
                return []
        if res.status_code >= 400:
            return []
        return [str(t["id"]) for t in (res.json().get("teams") or []) if t.get("id")]

    async def get_team_for_membership(
        self, team_id: UUID, *, bearer: str, actor_id: UUID
    ) -> tuple[str, int]:
        """Return (team_name, member_count) if the caller is on this team.

        Unlike get_team_for_registration this accepts any member, not just a
        captain: on the per-player model each teammate enters themselves.
        """
        headers = {"Authorization": bearer}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                team_res = await client.get(f"{self._base}/v1/teams/{team_id}", headers=headers)
                members_res = await client.get(
                    f"{self._base}/v1/teams/{team_id}/members", headers=headers
                )
            except httpx.HTTPError as exc:
                raise AppError(ErrorCode.INTERNAL, "could not verify the team right now") from exc

        if team_res.status_code == 404:
            raise AppError(ErrorCode.VALIDATION, "team not found")
        if team_res.status_code >= 400 or members_res.status_code >= 400:
            raise AppError(ErrorCode.FORBIDDEN, "you cannot register under this team")

        body = team_res.json()
        team = body.get("team") or body
        members = members_res.json().get("members") or []
        if not any(str(m.get("user_id")) == str(actor_id) for m in members):
            raise AppError(ErrorCode.FORBIDDEN, "you are not a member of this team")
        return team.get("name") or f"team-{team_id}", len(members)
