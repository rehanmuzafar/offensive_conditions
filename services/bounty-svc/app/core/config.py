"""Application configuration."""

from __future__ import annotations

import json
import re

from functools import lru_cache
from typing import Literal

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "bounty-svc"
    app_version: str = "0.1.0"

    # HTTP
    http_host: str = "0.0.0.0"
    http_port: int = 8009
    http_workers: int = 2
    # Read as a plain string, not list[str]: pydantic-settings decodes complex
    # types as JSON at the source level, before any validator runs, so a
    # list[str] annotation forces the value to be a JSON array. The Go auth
    # service reads this same variable and rejects JSON outright, so the
    # space/comma-separated form is the only one both runtimes accept.
    http_cors_origins_raw: str = Field(
        default="http://localhost:3000", alias="HTTP_CORS_ORIGINS"
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def http_cors_origins(self) -> list[str]:
        raw = self.http_cors_origins_raw.strip()
        # Tolerate the JSON form too. It is not what this reads natively, and a
        # bare re.split would turn it into one junk origin that silently matches
        # nothing — a CORS failure is far harder to trace than a parse error.
        if raw.startswith("["):
            return [str(o) for o in json.loads(raw)]
        return [o for o in re.split(r"[,\s]+", raw) if o]

    # gRPC
    grpc_port: int = 9009
    grpc_enable_reflection: bool = True
    grpc_max_recv_mb: int = 8

    # Database
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "offcon"
    db_user: str = "bounty_svc"
    db_password: str = ""
    db_sslmode: str = "disable"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    redis_db: int = 8
    redis_tls: bool = False

    # Auth
    auth_jwt_public_key_path: str = "./testdata/jwt.pub"
    auth_jwt_issuer: str = "https://auth.offensiveconditions.org"
    auth_jwt_audience: str = "offcon-api"
    auth_jwt_clock_skew_seconds: int = 5

    # Kafka
    kafka_brokers: str = "localhost:9092"

    kafka_topic_bounty_events: str = "bounty.events"
    kafka_topic_payment_events: str = "payment.events"
    kafka_consumer_group: str = "bounty-svc"
    kafka_use_tls: bool = False
    kafka_acks: str = "all"

    # Other services
    payment_svc_addr: str = "localhost:9007"
    notification_svc_addr: str = "localhost:9008"
    user_svc_addr: str = "localhost:9001"

    # S3 / MinIO for attachments
    s3_endpoint: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket_attachments: str = "offcon-bounty-attachments"
    s3_presigned_ttl_seconds: int = 600
    s3_use_ssl: bool = False

    # Limits
    limit_page_size_default: int = 25
    limit_page_size_max: int = 100
    limit_report_desc_max_chars: int = 50_000
    limit_attachment_max_mb: int = 100
    limit_comments_per_user_per_min: int = 30
    limit_reports_per_user_per_day: int = 20

    # Severity → bounty caps (cents). Default ceilings; programs override.
    severity_default_cap_cents_critical: int = 1_000_000   # $10k
    severity_default_cap_cents_high: int = 300_000          # $3k
    severity_default_cap_cents_medium: int = 100_000        # $1k
    severity_default_cap_cents_low: int = 25_000            # $250

    # Logging
    log_level: str = "info"
    log_format: Literal["console", "json"] = "console"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_sync_url(self) -> str:
        # For alembic + sync celery workers
        return (
            f"postgresql+psycopg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.redis_tls else "redis"
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
