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

    # --- App ---
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "ctf-svc"
    app_version: str = "0.1.0"

    # --- HTTP ---
    http_port: int = 8004
    http_host: str = "0.0.0.0"
    http_workers: int = 2
    http_cors_origins: list[str] = ["http://localhost:3000"]

    # --- gRPC ---
    grpc_port: int = 9004
    grpc_enable_reflection: bool = True
    grpc_max_recv_mb: int = 8

    # --- Database ---
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "offcon"
    db_user: str = "ctf_svc"
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

    # --- Redis ---
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: SecretStr = SecretStr("")
    redis_db: int = 3
    redis_tls: bool = False

    @computed_field
    @property
    def redis_url(self) -> str:
        scheme = "rediss" if self.redis_tls else "redis"
        pw = self.redis_password.get_secret_value()
        auth = f":{pw}@" if pw else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    # --- Auth ---
    auth_jwt_public_key_path: str = "./testdata/jwt.pub"
    # ---- entry-fee payments -------------------------------------------------
    # Which gateway processes CTF entry fees. "manual" needs no gateway at all:
    # the participant is shown bank details and an organiser confirms the
    # transfer, so paid events can run before a merchant account exists.
    ctf_payment_provider: str = "manual"
    # Shown to participants under the manual provider.
    payout_account_name: str = ""
    payout_account_number: str = ""
    payout_bank_name: str = ""
    payout_iban: str = ""

    auth_jwt_issuer: str = "https://auth.offensiveconditions.org"
    auth_jwt_audience: str = "offcon-api"
    auth_jwt_clock_skew_seconds: int = 5

    # --- Kafka ---
    kafka_brokers: str = "localhost:9092"

    kafka_topic_ctf_events: str = "ctf.events"
    kafka_topic_flagverify_events: str = "flagverify.events"  # consumed
    kafka_consumer_group: str = "ctf-svc"
    kafka_use_tls: bool = False
    kafka_acks: Literal["all", "one", "none"] = "all"

    # --- Flag verifier client ---
    flag_verifier_addr: str = "flag-verifier:9002"
    flag_verifier_use_tls: bool = False
    flag_verifier_timeout_seconds: float = 5.0

    # --- User service client (for team membership lookups) ---
    user_svc_addr: str = "user-svc:9001"

    # --- Scoring rules ---
    # Default CTFd-style decay: f(n) = max(min_points, base * ((1 - (n-1)*0.012)^4))
    dynamic_scoring_decay_factor: float = 0.012
    dynamic_scoring_decay_power: int = 4
    # First blood bonus order (1st = 5%, 2nd = 3%, 3rd = 1% of base by default)
    first_blood_bonus_percentages: list[float] = [0.05, 0.03, 0.01]

    # --- Freeze ---
    default_freeze_minutes_before_end: int = 60

    # --- WebSocket ---
    ws_max_connections_per_event: int = 5000
    ws_heartbeat_seconds: int = 30
    ws_idle_timeout_seconds: int = 300

    # --- Limits ---
    limit_page_size_default: int = 25
    limit_page_size_max: int = 100
    limit_submit_per_minute: int = 30  # per participant per challenge
    limit_announcement_max_chars: int = 4000

    # --- Logging ---
    log_level: Literal["debug", "info", "warn", "error"] = "info"
    log_format: Literal["json", "console"] = "json"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
