"""Application settings."""

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "writeup-svc"
    app_version: str = "0.1.0"

    http_port: int = 8006
    http_host: str = "0.0.0.0"
    http_workers: int = 2
    http_cors_origins: list[str] = ["http://localhost:3000"]

    grpc_port: int = 9006
    grpc_enable_reflection: bool = True
    grpc_max_recv_mb: int = 8

    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "offcon"
    db_user: str = "writeup_svc"
    db_password: SecretStr = SecretStr("")
    db_sslmode: str = "disable"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    @computed_field
    @property
    def database_url(self) -> str:
        pw = self.db_password.get_secret_value()
        return f"postgresql+asyncpg://{self.db_user}:{pw}@{self.db_host}:{self.db_port}/{self.db_name}"

    @computed_field
    @property
    def database_sync_url(self) -> str:
        pw = self.db_password.get_secret_value()
        return f"postgresql+psycopg://{self.db_user}:{pw}@{self.db_host}:{self.db_port}/{self.db_name}"

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: SecretStr = SecretStr("")
    redis_db: int = 5
    redis_tls: bool = False

    @computed_field
    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.redis_tls else "redis"
        pw = self.redis_password.get_secret_value()
        auth = f":{pw}@" if pw else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    auth_jwt_public_key_path: str = "./testdata/jwt.pub"
    auth_jwt_issuer: str = "https://auth.offensiveconditions.org"
    auth_jwt_audience: str = "offcon-api"
    auth_jwt_clock_skew_seconds: int = 5

    kafka_brokers: str = "localhost:9092"

    kafka_topic_writeup_events: str = "writeup.events"
    kafka_consumer_group: str = "writeup-svc"
    kafka_use_tls: bool = False
    kafka_acks: Literal["all", "one", "none"] = "all"

    # Cross-service clients
    scoring_svc_addr: str = "scoring:9004"
    content_svc_addr: str = "content-svc:9003"

    # Limits
    limit_page_size_default: int = 25
    limit_page_size_max: int = 100
    limit_writeup_max_chars: int = 200_000
    limit_comment_max_chars: int = 10_000
    limit_summary_max_chars: int = 500
    limit_submit_per_user_per_day: int = 5

    # Gating: require user to have solved the target before reading writeups
    require_solve_to_read: bool = True
    grace_for_authors: bool = True  # author can always read own writeup

    log_level: Literal["debug", "info", "warn", "error"] = "info"
    log_format: Literal["json", "console"] = "json"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
