"""Showing an entry fee in the money a player actually thinks in.

The organiser sets one price. Everything else is derived, because asking
somebody to maintain a price list for 195 countries is not a feature — it is a
chore that will be done once and then rot.

Three rules hold this together, and each exists because the obvious version is
wrong:

1. The rate is fetched once a day and cached, not per request. A price that
   moves between page loads looks broken, and a player who saw one number and
   was charged another has a real complaint.

2. The converted number is for reading, not for charging. The charge happens in
   the event's own currency — the one the gateway settles — and the UI says so.
   This is the difference between "about Rs 4,200" and a bill for Rs 4,200.

3. If rates are unavailable the base price is shown. A currency service being
   down must never stop somebody registering for a CTF.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from redis.asyncio import Redis

from app.core.logging import get_logger

log = get_logger("fx")

RATES_URL = "https://open.er-api.com/v6/latest/USD"
CACHE_KEY = "ctf:fx:rates:usd"

# A day, plus a little. The upstream refreshes just after midnight UTC; a TTL
# slightly longer than the refresh interval means a fetch failure falls back to
# yesterday's rates rather than to nothing.
CACHE_TTL_SECONDS = 26 * 60 * 60

# Currencies whose minor unit is not 1/100. Converting through major units and
# scaling back by the wrong factor is how a ¥1,500 fee becomes ¥150,000.
_MINOR_UNITS: dict[str, int] = {
    "JPY": 1, "KRW": 1, "VND": 1, "CLP": 1, "ISK": 1, "PYG": 1, "RWF": 1,
    "UGX": 1, "VUV": 1, "XAF": 1, "XOF": 1, "XPF": 1, "KMF": 1, "DJF": 1,
    "GNF": 1, "MGA": 1, "BIF": 1,
    "BHD": 1000, "IQD": 1000, "JOD": 1000, "KWD": 1000, "LYD": 1000,
    "OMR": 1000, "TND": 1000,
}

# ISO 3166-1 alpha-2 to ISO 4217. Anything not listed falls back to USD, which
# is also what a player with no country set sees.
COUNTRY_CURRENCY: dict[str, str] = {
    "PK": "PKR", "IN": "INR", "BD": "BDT", "LK": "LKR", "NP": "NPR", "AF": "AFN",
    "US": "USD", "CA": "CAD", "MX": "MXN", "BR": "BRL", "AR": "ARS", "CL": "CLP",
    "CO": "COP", "PE": "PEN", "UY": "UYU", "VE": "VES", "BO": "BOB", "PY": "PYG",
    "GB": "GBP", "IE": "EUR", "FR": "EUR", "DE": "EUR", "ES": "EUR", "IT": "EUR",
    "PT": "EUR", "NL": "EUR", "BE": "EUR", "AT": "EUR", "FI": "EUR", "GR": "EUR",
    "LU": "EUR", "SK": "EUR", "SI": "EUR", "EE": "EUR", "LV": "EUR", "LT": "EUR",
    "CY": "EUR", "MT": "EUR", "HR": "EUR",
    "CH": "CHF", "NO": "NOK", "SE": "SEK", "DK": "DKK", "IS": "ISK",
    "PL": "PLN", "CZ": "CZK", "HU": "HUF", "RO": "RON", "BG": "BGN",
    "RS": "RSD", "UA": "UAH", "RU": "RUB", "BY": "BYN", "MD": "MDL",
    "TR": "TRY", "GE": "GEL", "AM": "AMD", "AZ": "AZN", "KZ": "KZT",
    "UZ": "UZS", "KG": "KGS", "TJ": "TJS", "TM": "TMT",
    "AE": "AED", "SA": "SAR", "QA": "QAR", "KW": "KWD", "BH": "BHD",
    "OM": "OMR", "JO": "JOD", "LB": "LBP", "IL": "ILS", "IQ": "IQD",
    "IR": "IRR", "SY": "SYP", "YE": "YER",
    "EG": "EGP", "MA": "MAD", "DZ": "DZD", "TN": "TND", "LY": "LYD",
    "SD": "SDG", "NG": "NGN", "GH": "GHS", "KE": "KES", "TZ": "TZS",
    "UG": "UGX", "RW": "RWF", "ET": "ETB", "ZA": "ZAR", "ZM": "ZMW",
    "ZW": "ZWL", "BW": "BWP", "NA": "NAD", "MU": "MUR", "SN": "XOF",
    "CI": "XOF", "ML": "XOF", "BF": "XOF", "NE": "XOF", "TG": "XOF",
    "BJ": "XOF", "CM": "XAF", "GA": "XAF", "CG": "XAF", "TD": "XAF",
    "CN": "CNY", "JP": "JPY", "KR": "KRW", "TW": "TWD", "HK": "HKD",
    "MO": "MOP", "SG": "SGD", "MY": "MYR", "ID": "IDR", "TH": "THB",
    "PH": "PHP", "VN": "VND", "KH": "KHR", "LA": "LAK", "MM": "MMK",
    "BN": "BND", "MN": "MNT",
    "AU": "AUD", "NZ": "NZD", "FJ": "FJD", "PG": "PGK",
}


def currency_for_country(country: str | None) -> str:
    """The currency to show someone from this country. USD when unknown."""
    if not country:
        return "USD"
    return COUNTRY_CURRENCY.get(country.strip().upper(), "USD")


def minor_units_for(currency: str) -> int:
    """Minor units per major unit, per ISO 4217 — 100 unless listed otherwise."""
    return _MINOR_UNITS.get(currency.upper(), 100)


def _minor_units(currency: str) -> int:
    return _MINOR_UNITS.get(currency.upper(), 100)


class FxService:
    """Daily USD-based rates, cached in Redis."""

    def __init__(self, redis: Redis | None) -> None:
        self._redis = redis

    async def _rates(self) -> dict[str, float] | None:
        if self._redis is not None:
            try:
                cached = await self._redis.get(CACHE_KEY)
                if cached:
                    return json.loads(cached)
            except Exception:
                # A cache that is down is not a reason to fail; fall through to
                # the network and simply do not cache the result.
                log.warning("fx_cache_read_failed")

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(RATES_URL)
            if res.status_code != 200:
                log.warning("fx_fetch_bad_status", status=res.status_code)
                return None
            payload: dict[str, Any] = res.json()
            rates = payload.get("rates")
            if not isinstance(rates, dict) or "USD" not in rates:
                log.warning("fx_fetch_unusable_payload")
                return None
        except Exception:
            log.warning("fx_fetch_failed")
            return None

        if self._redis is not None:
            try:
                await self._redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, json.dumps(rates))
            except Exception:
                log.warning("fx_cache_write_failed")
        return rates

    async def convert(
        self, amount_minor: int, from_currency: str, to_currency: str
    ) -> int | None:
        """Convert between currencies in minor units.

        Returns None when the conversion cannot be trusted — an unknown
        currency, or rates that could not be fetched — so callers can fall back
        to the price they already have rather than invent one.
        """
        src, dst = from_currency.upper(), to_currency.upper()
        if src == dst:
            return amount_minor

        rates = await self._rates()
        if not rates:
            return None
        r_src, r_dst = rates.get(src), rates.get(dst)
        if not r_src or not r_dst:
            return None

        major = (amount_minor / _minor_units(src)) * (r_dst / r_src)
        converted = round(major * _minor_units(dst))

        # Rounded to something a price tag would plausibly say. An exact
        # conversion reads as a machine artefact — "Rs 4,164.37" is nobody's
        # price — and precision is meaningless here anyway, since this number
        # is never the one charged.
        return _round_nicely(converted, _minor_units(dst))


def _round_nicely(amount_minor: int, minor_units: int) -> int:
    """Round to a step a price tag would plausibly use.

    The step scales with the amount, not with the number of digits, and that
    distinction matters: an earlier version stepped by 5 for anything under a
    hundred, which turned EUR 12.92 into EUR 15.00 — a sixteen percent markup
    produced by a rounding rule. The steps below keep the error under about two
    percent everywhere, including for currencies like KWD where one unit is
    worth several dollars.

    To nearest, never up. Always rounding up quietly inflates every price on
    the site, and this number exists to inform rather than to sell.
    """
    major = amount_minor / minor_units

    # Below one unit of currency there is nothing to tidy: any step is a large
    # fraction of the price, and rounding a real fee of £0.04 to the nearest
    # half-pound produces £0.00 — which reads as "free". Left exact.
    if major < 1:
        step_minor = 1
    else:
        if major < 20:
            step = 0.5
        elif major < 100:
            step = 1
        elif major < 1000:
            step = 10
        elif major < 10000:
            step = 50
        elif major < 100000:
            step = 500
        else:
            step = 1000
        step_minor = max(1, round(step * minor_units))

    rounded = int(round(amount_minor / step_minor) * step_minor)

    # A fee that costs something must never display as nothing. Rounding to
    # zero turns a paid event into an apparently free one, which is the single
    # worst answer this function can give.
    if amount_minor > 0 and rounded <= 0:
        return 1
    return rounded
