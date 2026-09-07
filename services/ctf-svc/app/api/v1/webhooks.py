"""Payment notifications from Safepay.

Safepay's published collection documents how to *send* requests but not how an
incoming webhook is signed, and a signature scheme is not something to invent.
So this endpoint does not trust the notification at all. It reads one thing out
of it — a tracker token — and then asks Safepay directly what happened.

That is stronger than checking a signature, not weaker. A forged notification
cannot grant anybody an entry, because the answer that matters comes from an
authenticated call to Safepay rather than from the request body. Three things
are checked there and all three must hold:

    the tracker is in a settled state
    the amount matches what the team owes
    the tracker was created by our own merchant key

If a webhook secret is configured it is checked too, but as an early filter
rather than as the thing standing between an attacker and a free entry.
"""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_session
from app.models import EventTeamEntry
from app.services.payments import PaymentService
from app.services.safepay import SafepayClient

log = get_logger("webhooks")

router = APIRouter(prefix="/payments/webhook", tags=["webhooks"])

# States Safepay reports for a payment that has actually been taken. Anything
# else — including TRACKER_STARTED, which is what an abandoned checkout leaves
# behind — settles nothing.
SETTLED_STATES = {"TRACKER_ENDED", "TRACKER_COMPLETED", "AUTHORIZED", "CAPTURED", "PAID"}


def _find_tracker(payload: Any) -> str | None:
    """Pull a tracker token out of a notification.

    Written to search rather than to index a known path: the exact envelope is
    not documented, and a webhook that silently does nothing because a field
    moved is worse than one that looks a little harder.
    """
    seen: list[Any] = [payload]
    while seen:
        node = seen.pop()
        if isinstance(node, str) and node.startswith("track_"):
            return node
        if isinstance(node, dict):
            seen.extend(node.values())
        elif isinstance(node, list):
            seen.extend(node)
    return None


@router.post("/safepay")
async def safepay_webhook(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    x_sfpy_signature: str | None = Header(default=None, alias="X-SFPY-Signature"),
) -> dict[str, str]:
    """Settle a team's entry once Safepay confirms the money arrived.

    Always answers 200. A gateway that receives an error retries, and retrying
    will not fix a notification we have decided not to act on — it only fills
    the log with the same rejection. What happened is in the response body and
    in the logs instead.
    """
    settings = get_settings()
    raw = await request.body()

    secret = settings.safepay_webhook_secret.get_secret_value()
    if secret and x_sfpy_signature:
        # Constant-time, because comparing secrets with == leaks their contents
        # through timing given enough attempts.
        if not hmac.compare_digest(secret, x_sfpy_signature):
            log.warning("safepay_webhook_bad_signature")
            return {"status": "ignored", "reason": "signature mismatch"}

    try:
        payload = await request.json()
    except Exception:
        log.warning("safepay_webhook_unparseable", body=raw[:200].decode("utf-8", "replace"))
        return {"status": "ignored", "reason": "unparseable body"}

    tracker = _find_tracker(payload)
    if not tracker:
        log.warning("safepay_webhook_no_tracker", payload=str(payload)[:400])
        return {"status": "ignored", "reason": "no tracker in payload"}

    entry = (
        await session.execute(
            select(EventTeamEntry).where(EventTeamEntry.provider_reference == tracker)
        )
    ).scalar_one_or_none()
    if entry is None:
        # Not ours, or ours and already reconciled under a different reference.
        log.warning("safepay_webhook_unknown_tracker", tracker=tracker)
        return {"status": "ignored", "reason": "unknown tracker"}

    if entry.payment_status == "paid":
        return {"status": "ok", "reason": "already settled"}

    # The part that actually decides. Everything above only got us a tracker to
    # ask about.
    client = SafepayClient(settings)
    state = await client.fetch_payment(tracker)
    if state is None:
        log.error("safepay_webhook_lookup_failed", tracker=tracker)
        return {"status": "ignored", "reason": "could not verify with safepay"}

    if state.get("state") not in SETTLED_STATES:
        log.info("safepay_webhook_not_settled", tracker=tracker, state=state.get("state"))
        return {"status": "ignored", "reason": f"state is {state.get('state')}"}

    if state.get("api_key") != settings.safepay_merchant_key:
        log.error("safepay_webhook_foreign_tracker", tracker=tracker)
        return {"status": "ignored", "reason": "tracker belongs to another merchant"}

    amount, currency = state.get("amount"), state.get("currency")
    if amount != entry.amount_cents or (currency or "").upper() != (entry.currency or "").upper():
        # Underpaying should not buy an entry, and a mismatch is worth a human
        # look rather than a silent settle at whatever was actually sent.
        log.error(
            "safepay_webhook_amount_mismatch",
            tracker=tracker,
            paid=amount,
            paid_currency=currency,
            owed=entry.amount_cents,
            owed_currency=entry.currency,
        )
        return {"status": "ignored", "reason": "amount does not match"}

    svc = PaymentService(session, settings)
    await svc.confirm_team(
        entry.event_id,
        team_id=entry.team_id,
        provider_reference=tracker,
        amount_cents=amount,
    )
    await session.commit()

    log.info("safepay_webhook_settled", tracker=tracker, team_id=str(entry.team_id))
    return {"status": "ok", "reason": "settled"}
