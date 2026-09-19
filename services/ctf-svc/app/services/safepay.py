"""Safepay adapter — creating a payment session a captain can be sent to.

Safepay is used rather than Stripe because Stripe does not let a business in
Pakistan receive money. It also covers cards, JazzCash and EasyPaisa behind one
integration, which is why nothing here branches on the method: the payer picks
one on Safepay's own page, and this service only has to get them there.

The contract below comes from Safepay's published API collection, not from
guesswork:

    POST {base}/order/payments/v3/
    headers: X-SFPY-MERCHANT-KEY, X-SFPY-MERCHANT-SECRET
    body:    merchant_api_key, intent, mode, currency, amount, metadata
    returns: data.tracker.token  ->  "track_..."

Sandbox and production are different hosts, so switching between them is a
configuration change and never a code change.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.services.fx import minor_units_for

log = get_logger("safepay")


class SafepayClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._base = settings.safepay_base_url
        self._key = settings.safepay_merchant_key
        self._secret = settings.safepay_merchant_secret.get_secret_value()

    @property
    def configured(self) -> bool:
        return bool(self._key and self._secret)

    async def create_checkout(
        self,
        *,
        amount_minor: int,
        currency: str,
        reference: str,
    ) -> tuple[str, str]:
        """Open a hosted payment page and return (tracker, url).

        A quick link rather than a tracker on its own. The tracker endpoint
        exists and creates a payment session happily, but the checkout page it
        is meant to be paired with is a minified single-page app whose
        parameters are not documented anywhere — the obvious guess produced
        "Unable to make request" and reading the bundle showed the name I had
        taken for a checkout parameter was Google Analytics' transport setting.
        Reverse-engineering someone's checkout to take money through it is the
        wrong shape of solution.

        The quick link is documented, works, and happens to fit better: it
        returns the tracker up front, so the webhook still matches on the same
        value it always did, and it carries our reference unchanged for anyone
        reconciling a payment by hand.
        """
        if not self.configured:
            raise AppError(
                ErrorCode.INTERNAL,
                "safepay is selected but its keys are not configured",
            )

        # Major units, not minor. Quick links take rupees where the rest of this
        # codebase counts paisa, and sending the stored value straight through
        # displayed ₨250,000.00 for a ₨2,500.00 fee — a hundred times the
        # price, on a page a customer was about to pay from. Caught by reading
        # the rendered page rather than the API's 200.
        major = amount_minor / minor_units_for(currency)

        payload = {
            "amount": int(major) if major == int(major) else major,
            "currency": currency.upper(),
            "note": f"OFFCON entry fee — {reference}",
            "workflow": "MANUAL",
            "reference": reference,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    f"{self._base}/invoice/quick-links/v2/",
                    json=payload,
                    headers={
                        "X-SFPY-MERCHANT-KEY": self._key,
                        "X-SFPY-MERCHANT-SECRET": self._secret,
                        "Content-Type": "application/json",
                    },
                )
        except httpx.HTTPError as exc:
            log.error("safepay_unreachable", error=str(exc))
            raise AppError(
                ErrorCode.INTERNAL, "could not reach the payment provider"
            ) from exc

        if res.status_code >= 400:
            # Logged, not returned: a gateway's error text can carry account
            # details, and the payer can do nothing with it.
            log.error(
                "safepay_rejected",
                status=res.status_code,
                body=res.text[:500],
                reference=reference,
            )
            raise AppError(ErrorCode.INTERNAL, "the payment provider refused the request")

        try:
            data = res.json()["data"]
            tracker = data["payment"][0]["sp_tracker"]
            url = next(
                m["recipient_view_url"]
                for m in data["metadata"]
                if m.get("recipient_view_url")
            )
        except (KeyError, IndexError, TypeError, ValueError, StopIteration):
            log.error("safepay_unexpected_shape", body=res.text[:500])
            raise AppError(ErrorCode.INTERNAL, "unexpected response from the payment provider")

        log.info(
            "safepay_checkout_created",
            tracker=tracker,
            link=data.get("id"),
            reference=reference,
        )
        return str(tracker), str(url)

    async def fetch_payment(self, tracker: str) -> dict[str, Any] | None:
        """Ask Safepay what actually happened to a payment.

        This is what a webhook is checked against, so it is deliberately the
        only place the answer comes from. Returns the few fields that decide
        whether an entry may be settled, flattened out of a response that nests
        them three deep, or None when the question could not be answered — in
        which case the caller settles nothing.
        """
        if not self.configured:
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(
                    f"{self._base}/reporter/api/v2/payments/{tracker}",
                    headers={
                        "X-SFPY-MERCHANT-KEY": self._key,
                        "X-SFPY-MERCHANT-SECRET": self._secret,
                    },
                )
        except httpx.HTTPError as exc:
            log.error("safepay_lookup_unreachable", tracker=tracker, error=str(exc))
            return None

        if res.status_code >= 400:
            log.error("safepay_lookup_failed", tracker=tracker, status=res.status_code)
            return None

        try:
            data = res.json()["data"]
            base = (data.get("purchase_totals") or {}).get("base_amount") or {}
            meta = data.get("metadata") or {}
            order = meta.get("order_id") or {}
            return {
                "state": data.get("state"),
                "amount": base.get("amount"),
                "currency": base.get("currency"),
                "api_key": (data.get("client") or {}).get("api_key"),
                # Our own reference, which survives the round trip and is what
                # a human uses to match a payment to a team by hand.
                "order_id": order.get("value") if isinstance(order, dict) else order,
            }
        except (KeyError, TypeError, ValueError):
            log.error("safepay_lookup_unexpected_shape", body=res.text[:400])
            return None
