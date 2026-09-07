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

from urllib.parse import urlencode

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger

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

    async def create_tracker(
        self,
        *,
        amount_minor: int,
        currency: str,
        reference: str,
    ) -> str:
        """Open a payment session and return its tracker token.

        The amount is sent in minor units, matching how it is stored — no
        conversion here, because a rounding step between the price shown and the
        amount charged is exactly the kind of thing nobody notices until the
        numbers disagree.
        """
        if not self.configured:
            raise AppError(
                ErrorCode.INTERNAL,
                "safepay is selected but its keys are not configured",
            )

        # metadata takes exactly two keys. Safepay validates the set and answers
        # 500 with "unsupported meta key <name>" for anything else, so this is
        # not a place to stash event or team ids — verified against sandbox,
        # which rejected every other name tried.
        #
        # Nothing is lost by that: the tracker is written onto the team's entry
        # as provider_reference the moment it is created, so a webhook is
        # matched by the token rather than by anything carried here.
        payload = {
            "merchant_api_key": self._key,
            "intent": "CYBERSOURCE",
            "mode": "payment",
            "currency": currency.upper(),
            "amount": amount_minor,
            "metadata": {"order_id": reference, "source": "offcon"},
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    f"{self._base}/order/payments/v3/",
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
            # The body is logged and not returned: a gateway's error text can
            # carry account details, and the payer can do nothing with it.
            log.error(
                "safepay_rejected",
                status=res.status_code,
                body=res.text[:500],
                reference=reference,
            )
            raise AppError(ErrorCode.INTERNAL, "the payment provider refused the request")

        try:
            token = res.json()["data"]["tracker"]["token"]
        except (KeyError, TypeError, ValueError):
            log.error("safepay_unexpected_shape", body=res.text[:500])
            raise AppError(ErrorCode.INTERNAL, "unexpected response from the payment provider")

        log.info("safepay_tracker_created", tracker=token, reference=reference)
        return str(token)

    def checkout_url(self, tracker: str, *, redirect_url: str | None = None) -> str:
        """Where to send the payer once a tracker exists."""
        params: dict[str, str] = {
            "beacon": tracker,
            "env": "production" if self._s.safepay_environment.lower() == "production" else "sandbox",
            "source": "custom",
        }
        if redirect_url:
            params["redirect_url"] = redirect_url
        return f"{self._base}/embedded/?{urlencode(params)}"
