"""JWT validation, matching the auth-svc issued tokens."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode


@dataclass(frozen=True)
class Claims:
    """Parsed JWT claims."""

    user_id: UUID
    session_id: str
    tier: str
    roles: tuple[str, ...]
    exp: int

    def has_role(self, role: str) -> bool:
        return role in self.roles

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    @property
    def is_moderator(self) -> bool:
        return any(r in self.roles for r in ("admin", "moderator"))

    @property
    def is_content_creator(self) -> bool:
        return any(r in self.roles for r in ("admin", "content_creator"))

    @property
    def is_staff(self) -> bool:
        return any(r in self.roles for r in ("admin", "moderator", "support"))


class JWTValidator:
    """RS256 JWT validator with public key loaded from disk."""

    def __init__(self, settings: Settings) -> None:
        key_path = Path(settings.auth_jwt_public_key_path)
        if not key_path.exists():
            raise FileNotFoundError(f"JWT public key not found: {key_path}")
        with key_path.open("rb") as f:
            pem = f.read()
        self._public_key = load_pem_public_key(pem)
        self._issuer = settings.auth_jwt_issuer
        self._audience = settings.auth_jwt_audience
        self._skew = settings.auth_jwt_clock_skew_seconds

    def validate(self, token: str) -> Claims:
        try:
            decoded = jwt.decode(
                token,
                self._public_key,  # type: ignore[arg-type]
                algorithms=["RS256"],
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._skew,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.ExpiredSignatureError:
            raise AppError(ErrorCode.UNAUTHORIZED, "token expired")
        except jwt.InvalidTokenError as e:
            raise AppError(ErrorCode.UNAUTHORIZED, f"invalid token: {e}")

        try:
            user_id = UUID(decoded["sub"])
        except (KeyError, ValueError) as e:
            raise AppError(ErrorCode.UNAUTHORIZED, f"invalid sub: {e}")

        return Claims(
            user_id=user_id,
            session_id=decoded.get("sid", ""),
            tier=decoded.get("tier", "free"),
            roles=tuple(decoded.get("roles", [])),
            exp=int(decoded.get("exp", 0)),
        )
