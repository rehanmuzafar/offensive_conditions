"""Program service: CRUD, scope, lifecycle transitions."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Program, ProgramReward, ProgramScope
from app.schemas import ProgramCreate, ProgramUpdate, RewardTier, ScopeItem

log = get_logger("programs")

_ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"published"},
    "published": {"paused", "closed"},
    "paused": {"published", "closed"},
    "closed": set(),
}


class ProgramService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =========================================================================
    # Reads
    # =========================================================================

    async def get_by_id(self, program_id: UUID) -> Program:
        result = await self.session.execute(
            select(Program).where(Program.id == program_id)
        )
        program = result.scalar_one_or_none()
        if not program:
            raise AppError(ErrorCode.PROGRAM_NOT_FOUND, "program not found")
        return program

    async def get_by_slug(self, slug: str) -> Program:
        result = await self.session.execute(
            select(Program).where(func.lower(Program.slug) == slug.lower())
        )
        program = result.scalar_one_or_none()
        if not program:
            raise AppError(ErrorCode.PROGRAM_NOT_FOUND, "program not found")
        return program

    async def list_(
        self,
        *,
        status: str | None = "published",
        visibility: str | None = "public",
        owner_org_id: UUID | None = None,
        search: str | None = None,
        asset_type: str | None = None,
        has_bounty: bool | None = None,
        viewer_is_owner: bool = False,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Program], int]:
        stmt = select(Program)
        count_stmt = select(func.count()).select_from(Program)

        if not viewer_is_owner:
            # Public listing: only published + public
            stmt = stmt.where(Program.status == "published", Program.visibility == "public")
            count_stmt = count_stmt.where(
                Program.status == "published", Program.visibility == "public"
            )
        else:
            if status:
                stmt = stmt.where(Program.status == status)
                count_stmt = count_stmt.where(Program.status == status)
            if visibility:
                stmt = stmt.where(Program.visibility == visibility)
                count_stmt = count_stmt.where(Program.visibility == visibility)
            if owner_org_id:
                stmt = stmt.where(Program.owner_org_id == owner_org_id)
                count_stmt = count_stmt.where(Program.owner_org_id == owner_org_id)

        if search:
            pattern = f"%{search.lower()}%"
            stmt = stmt.where(func.lower(Program.name).like(pattern))
            count_stmt = count_stmt.where(func.lower(Program.name).like(pattern))

        if asset_type:
            # "Which programs let me test this kind of thing" is the first
            # question a hacker asks, so it filters on scope rather than on
            # anything stored on the program itself.
            scoped = (
                select(ProgramScope.program_id)
                .where(
                    ProgramScope.asset_type == asset_type,
                    ProgramScope.in_scope.is_(True),
                )
                .scalar_subquery()
            )
            stmt = stmt.where(Program.id.in_(scoped))
            count_stmt = count_stmt.where(Program.id.in_(scoped))

        if has_bounty is not None:
            paying = Program.max_reward_cents.isnot(None) & (Program.max_reward_cents > 0)
            stmt = stmt.where(paying if has_bounty else ~paying)
            count_stmt = count_stmt.where(paying if has_bounty else ~paying)

        stmt = stmt.order_by(Program.published_at.desc().nullslast(), Program.created_at.desc())
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def thanks(self, program_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
        """Researchers ranked by what they found here.

        Ranked by accepted reports weighted by severity rather than by raw
        count, because ten informational findings are not one critical. Only
        reports that survived triage count — the whole point of the page is that
        it is earned.
        """
        rows = (
            await self.session.execute(
                text(
                    """
                    SELECT r.researcher_id,
                           u.username,
                           count(*) AS accepted,
                           count(*) FILTER (WHERE r.severity = 'critical') AS criticals,
                           COALESCE(sum(r.bounty_cents), 0) AS earned,
                           sum(CASE r.severity
                                 WHEN 'critical' THEN 40
                                 WHEN 'high'     THEN 20
                                 WHEN 'medium'   THEN 10
                                 WHEN 'low'      THEN 4
                                 ELSE 0 END) AS reputation
                      FROM bounty.reports r
                      LEFT JOIN auth.users u ON u.id = r.researcher_id
                     WHERE r.program_id = :pid
                       AND r.state IN ('accepted', 'resolved', 'paid')
                       AND r.severity IN ('low', 'medium', 'high', 'critical')
                     GROUP BY r.researcher_id, u.username
                     ORDER BY reputation DESC, accepted DESC
                     LIMIT :limit
                    """
                ),
                {"pid": program_id, "limit": limit},
            )
        ).mappings().all()
        return [dict(r) for r in rows]

    async def collaborators(self, program_id: UUID, limit: int = 100) -> list[dict[str, Any]]:
        """Everyone who has reported here, most recent first.

        Unranked and unfiltered by outcome — this answers "who else is looking
        at this", which a rejected report answers just as well as an accepted
        one.
        """
        rows = (
            await self.session.execute(
                text(
                    """
                    SELECT r.researcher_id, u.username,
                           max(r.created_at) AS last_report_at,
                           count(*) AS reports
                      FROM bounty.reports r
                      LEFT JOIN auth.users u ON u.id = r.researcher_id
                     WHERE r.program_id = :pid
                     GROUP BY r.researcher_id, u.username
                     ORDER BY last_report_at DESC
                     LIMIT :limit
                    """
                ),
                {"pid": program_id, "limit": limit},
            )
        ).mappings().all()
        return [dict(r) for r in rows]

    async def updates(self, program_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                text(
                    """
                    SELECT up.id, up.title, up.body_md, up.created_at,
                           u.username AS author_name
                      FROM bounty.program_updates up
                      LEFT JOIN auth.users u ON u.id = up.author_id
                     WHERE up.program_id = :pid AND up.published
                     ORDER BY up.created_at DESC
                     LIMIT :limit
                    """
                ),
                {"pid": program_id, "limit": limit},
            )
        ).mappings().all()
        return [dict(r) for r in rows]

    async def post_update(
        self, program_id: UUID, *, author_id: UUID, title: str, body_md: str
    ) -> None:
        await self.session.execute(
            text(
                """
                INSERT INTO bounty.program_updates (program_id, author_id, title, body_md)
                VALUES (:pid, :aid, :title, :body)
                """
            ),
            {"pid": program_id, "aid": author_id, "title": title, "body": body_md},
        )

    async def card_stats(self, program_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
        """The numbers a program card shows, for a whole page of programs.

        Three things the card needs that the programs table does not hold: which
        asset types are in scope and how many of each, how many distinct people
        have reported, and how reliably the program answers. All three are
        aggregates over other tables, so they are fetched once for the page
        rather than per card — a list of twenty programs would otherwise be
        sixty extra queries.

        Response efficiency is measured, not declared: of the reports old enough
        for the program's own response SLA to have expired, the share that got a
        first response inside it. A program with nothing old enough to judge
        reports None rather than a flattering 100%.
        """
        if not program_ids:
            return {}

        scope_rows = (
            await self.session.execute(
                text(
                    """
                    SELECT program_id, asset_type, count(*) AS n
                      FROM bounty.program_scope
                     WHERE program_id = ANY(:ids) AND in_scope
                     GROUP BY program_id, asset_type
                     ORDER BY n DESC
                    """
                ),
                {"ids": program_ids},
            )
        ).mappings().all()

        report_rows = (
            await self.session.execute(
                text(
                    """
                    SELECT r.program_id,
                           count(DISTINCT r.researcher_id) AS hackers,
                           count(*) FILTER (
                             WHERE now() > r.created_at
                                   + (p.response_sla_hours * interval '1 hour')
                           ) AS judgeable,
                           count(*) FILTER (
                             WHERE now() > r.created_at
                                   + (p.response_sla_hours * interval '1 hour')
                               AND r.triaged_at IS NOT NULL
                               AND r.triaged_at <= r.created_at
                                   + (p.response_sla_hours * interval '1 hour')
                           ) AS in_time
                      FROM bounty.reports r
                      JOIN bounty.programs p ON p.id = r.program_id
                     WHERE r.program_id = ANY(:ids)
                     GROUP BY r.program_id
                    """
                ),
                {"ids": program_ids},
            )
        ).mappings().all()

        out: dict[UUID, dict[str, Any]] = {
            pid: {"asset_counts": [], "hackers": 0, "response_efficiency": None}
            for pid in program_ids
        }
        for row in scope_rows:
            out[row["program_id"]]["asset_counts"].append(
                {"asset_type": row["asset_type"], "count": int(row["n"])}
            )
        for row in report_rows:
            entry = out[row["program_id"]]
            entry["hackers"] = int(row["hackers"])
            judgeable = int(row["judgeable"])
            entry["response_efficiency"] = (
                round(int(row["in_time"]) / judgeable, 4) if judgeable else None
            )
        return out

    async def get_scope(self, program_id: UUID) -> list[ProgramScope]:
        result = await self.session.execute(
            select(ProgramScope)
            .where(ProgramScope.program_id == program_id)
            .order_by(ProgramScope.asset_type, ProgramScope.asset_identifier)
        )
        return list(result.scalars().all())

    async def get_rewards(self, program_id: UUID) -> list[ProgramReward]:
        result = await self.session.execute(
            select(ProgramReward).where(ProgramReward.program_id == program_id)
        )
        return list(result.scalars().all())

    # =========================================================================
    # Create + update
    # =========================================================================

    async def create(self, *, owner_user_id: UUID, data: ProgramCreate) -> Program:
        program = Program(
            slug=data.slug,
            name=data.name,
            # Falls back to the creating admin: the column is NOT NULL and
            # there is no organisation directory to resolve a real one from.
            owner_org_id=data.owner_org_id or owner_user_id,
            owner_user_id=owner_user_id,
            description=data.description,
            policy=data.policy,
            visibility=data.visibility,
            currency=data.currency,
            min_reward_cents=data.min_reward_cents,
            max_reward_cents=data.max_reward_cents,
            disclosure_policy=data.disclosure_policy,
            response_sla_hours=data.response_sla_hours,
            triage_sla_hours=data.triage_sla_hours,
            resolution_sla_days=data.resolution_sla_days,
            in_scope_summary=data.in_scope_summary,
            out_of_scope_summary=data.out_of_scope_summary,
            safe_harbor=data.safe_harbor,
            status="draft",
        )
        self.session.add(program)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.CONFLICT, "program slug already in use")

        # Scope + reward tiers
        for item in data.scope:
            self.session.add(
                ProgramScope(
                    program_id=program.id,
                    asset_type=item.asset_type,
                    asset_identifier=item.asset_identifier,
                    severity_max=item.severity_max,
                    in_scope=item.in_scope,
                    notes=item.notes,
                )
            )
        for reward in data.rewards:
            self.session.add(
                ProgramReward(
                    program_id=program.id,
                    severity=reward.severity,
                    min_cents=reward.min_cents,
                    max_cents=reward.max_cents,
                    currency=reward.currency,
                )
            )
        await self.session.flush()
        log.info(
            "program_created",
            program_id=str(program.id),
            slug=program.slug,
            owner=str(owner_user_id),
        )
        return program

    async def update(
        self, program_id: UUID, *, actor_id: UUID, data: ProgramUpdate
    ) -> Program:
        program = await self.get_by_id(program_id)
        if program.owner_user_id != actor_id:
            raise AppError(
                ErrorCode.NOT_PROGRAM_OWNER, "only the program owner can edit"
            )
        body = data.model_dump(exclude_unset=True)
        for k, v in body.items():
            setattr(program, k, v)
        program.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        log.info("program_updated", program_id=str(program_id), actor=str(actor_id))
        return program

    async def replace_scope(
        self, program_id: UUID, *, actor_id: UUID, scope: list[ScopeItem]
    ) -> list[ProgramScope]:
        program = await self.get_by_id(program_id)
        if program.owner_user_id != actor_id:
            raise AppError(
                ErrorCode.NOT_PROGRAM_OWNER, "only the program owner can edit scope"
            )
        # Delete + reinsert (simpler than diffing)
        await self.session.execute(
            ProgramScope.__table__.delete().where(ProgramScope.program_id == program_id)
        )
        for item in scope:
            self.session.add(
                ProgramScope(
                    program_id=program_id,
                    asset_type=item.asset_type,
                    asset_identifier=item.asset_identifier,
                    severity_max=item.severity_max,
                    in_scope=item.in_scope,
                    notes=item.notes,
                )
            )
        await self.session.flush()
        return await self.get_scope(program_id)

    async def replace_rewards(
        self, program_id: UUID, *, actor_id: UUID, rewards: list[RewardTier]
    ) -> list[ProgramReward]:
        program = await self.get_by_id(program_id)
        if program.owner_user_id != actor_id:
            raise AppError(
                ErrorCode.NOT_PROGRAM_OWNER, "only the program owner can edit rewards"
            )
        await self.session.execute(
            ProgramReward.__table__.delete().where(ProgramReward.program_id == program_id)
        )
        for r in rewards:
            self.session.add(
                ProgramReward(
                    program_id=program_id,
                    severity=r.severity,
                    min_cents=r.min_cents,
                    max_cents=r.max_cents,
                    currency=r.currency,
                )
            )
        await self.session.flush()
        return await self.get_rewards(program_id)

    # =========================================================================
    # Lifecycle
    # =========================================================================

    async def transition_status(
        self, program_id: UUID, *, new_status: str, actor_id: UUID
    ) -> Program:
        program = await self.get_by_id(program_id)
        if program.owner_user_id != actor_id:
            raise AppError(
                ErrorCode.NOT_PROGRAM_OWNER, "only the program owner can change status"
            )
        allowed = _ALLOWED_STATUS_TRANSITIONS.get(program.status, set())
        if new_status not in allowed:
            raise AppError(
                ErrorCode.PROGRAM_INVALID_STATE,
                f"cannot transition from {program.status} to {new_status}",
            )
        program.status = new_status
        now = datetime.now(timezone.utc)
        if new_status == "published":
            program.published_at = program.published_at or now
            program.paused_at = None
        elif new_status == "paused":
            program.paused_at = now
        elif new_status == "closed":
            program.closed_at = now
        program.updated_at = now
        await self.session.flush()
        log.info(
            "program_status_changed",
            program_id=str(program_id),
            new_status=new_status,
            actor=str(actor_id),
        )
        return program

    # =========================================================================
    # Scope validation (used by report submission)
    # =========================================================================

    async def is_asset_in_scope(
        self, program_id: UUID, *, asset_identifier: str | None
    ) -> bool:
        """Return True if the given asset matches an in-scope entry.

        Match strategy:
          - exact identifier match for domain/ip/mobile_app/source_code/api/other
          - wildcard `*.example.com` matches any subdomain of example.com
          - if program has zero scope entries, treat as fully in-scope (lenient
            mode — programs that want strict gating must declare scope)
          - if `asset_identifier` is None, treat as in-scope (researcher omitted)
        """
        if asset_identifier is None:
            return True
        scope = await self.get_scope(program_id)
        if not scope:
            return True
        target = asset_identifier.lower().strip()
        for entry in scope:
            if not entry.in_scope:
                continue
            ident = entry.asset_identifier.lower().strip()
            if entry.asset_type == "wildcard":
                # *.example.com → matches anything ending in .example.com
                base = ident.lstrip("*.")
                if target == base or target.endswith("." + base):
                    return True
            elif ident == target:
                return True
        return False
