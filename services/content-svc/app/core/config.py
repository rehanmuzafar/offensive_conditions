"""Application settings, loaded from environment via pydantic-settings."""

import json
import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Top-level settings. All fields are populated from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # --- App ---
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "content-svc"
    app_version: str = "0.1.0"

    # --- HTTP ---
    http_port: int = 8003
    http_host: str = "0.0.0.0"
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
    http_max_upload_mb: int = 50  # for content creator uploads

    # --- gRPC ---
    grpc_port: int = 9003
    grpc_enable_reflection: bool = True
    grpc_max_recv_mb: int = 8

    # --- Database ---
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "offcon"
    db_user: str = "content_svc"
    db_password: SecretStr = SecretStr("")
    db_sslmode: str = "disable"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    @computed_field
    @property
    def database_url(self) -> str:
        pw = self.db_password.get_secret_value()
        return (
            f"postgresql+asyncpg://{self.db_user}:{pw}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @computed_field
    @property
    def database_sync_url(self) -> str:
        """Sync URL for Alembic and Celery tasks."""
        pw = self.db_password.get_secret_value()
        return (
            f"postgresql+psycopg://{self.db_user}:{pw}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    # --- Redis ---
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: SecretStr = SecretStr("")
    redis_db: int = 2
    redis_tls: bool = False

    @computed_field
    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.redis_tls else "redis"
        pw = self.redis_password.get_secret_value()
        auth = f":{pw}@" if pw else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    # --- Auth (JWT validation) ---
    auth_jwt_public_key_path: str = "./testdata/jwt.pub"
    auth_jwt_issuer: str = "https://auth.offensiveconditions.org"
    auth_jwt_audience: str = "offcon-api"
    auth_jwt_clock_skew_seconds: int = 5

    # --- Kafka ---
    kafka_brokers: str = "localhost:9092"

    kafka_topic_content_events: str = "content.events"
    kafka_topic_scoring_events: str = "scoring.events"  # consumed
    kafka_consumer_group: str = "content-svc"
    kafka_use_tls: bool = False
    kafka_acks: Literal["all", "one", "none"] = "all"

    # --- Storage (MinIO/S3) ---
    storage_endpoint: str = "localhost:9000"
    storage_access_key: SecretStr = SecretStr("minioadmin")
    storage_secret_key: SecretStr = SecretStr("minioadmin")
    storage_use_ssl: bool = False
    storage_region: str = "us-east-1"
    storage_media_bucket: str = "offcon-content-media"
    storage_files_bucket: str = "offcon-content-files"
    storage_cdn_base_url: str = ""
    # Browser-reachable address of the object store. The internal endpoint
    # (minio:9000) only resolves inside the Docker network, so uploaded banner
    # URLs must be built from this instead.
    storage_public_base_url: str = ""

    # --- Limits ---
    limit_search_max_results: int = 100
    limit_page_size_default: int = 25
    limit_page_size_max: int = 100
    limit_review_max_chars: int = 5000
    limit_machine_intro_max_chars: int = 50_000
    limit_machine_walkthrough_max_chars: int = 200_000

    # --- Tier gating ---
    free_tier_machine_quota_per_month: int = 10  # advisory; orchestrator enforces

    # --- Logging ---
    log_level: Literal["debug", "info", "warn", "error"] = "info"
    log_format: Literal["json", "console"] = "json"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
