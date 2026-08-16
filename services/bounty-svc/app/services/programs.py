"""Program service: CRUD, scope, lifecycle transitions."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
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

        stmt = stmt.order_by(Program.published_at.desc().nullslast(), Program.created_at.desc())
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

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
            owner_org_id=data.owner_org_id,
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
