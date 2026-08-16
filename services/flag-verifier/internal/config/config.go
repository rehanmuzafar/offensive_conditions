package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App         AppConfig
	HTTP        HTTPConfig
	DB          DBConfig
	Redis       RedisConfig
	Auth        AuthConfig
	Kafka       KafkaConfig
	Vault       VaultConfig
	RateLimit   RateLimitConfig
	Idempotency IdempotencyConfig
	FlagFormat  FlagFormatConfig
	Orchestrator OrchestratorConfig
	Log         LogConfig
}

type AppConfig struct {
	Env     string
	Name    string
	Version string
}

func (a AppConfig) IsProduction() bool  { return a.Env == "production" }
func (a AppConfig) IsDevelopment() bool { return a.Env == "development" }

type HTTPConfig struct {
	Port            int
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
	TrustedProxies  []string
	CORSOrigins     []string
}

type DBConfig struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password string
	SSLMode  string
	MaxConns int
	MinConns int
}

func (c DBConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.User, c.Password, c.Host, c.Port, c.Name, c.SSLMode)
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	PoolSize int
	TLS      bool
}

type AuthConfig struct {
	JWTPublicKeyPath string
	JWTIssuer        string
	JWTAudience      string
	JWTClockSkew     time.Duration
	TokenCacheTTL    time.Duration
}

type KafkaConfig struct {
	Brokers              []string
	TopicFlagSubmissions string
	UseTLS               bool
	Acks                 string // "all" | "one"
}

type VaultConfig struct {
	Addr             string
	TokenPath        string
	Token            string // direct token (dev only)
	FlagSecretsPath  string // e.g. "secret/flag-hmac"
	RefreshInterval  time.Duration
	Enabled          bool
}

type RateLimitConfig struct {
	PerContentPerMin int
	PerUserPerMin    int
	PerIPPerMin      int
	CooldownSeconds  int
	IPCooldownSeconds int
	WindowSeconds    int
}

type IdempotencyConfig struct {
	TTLSeconds int
	Enabled    bool
}

type FlagFormatConfig struct {
	Prefix    string // OFFCON{
	Suffix    string // }
	HMACBytes int    // 16 → 32 hex chars
	MaxLength int    // safety check
}

type OrchestratorConfig struct {
	GRPCAddr    string
	GRPCTimeout time.Duration
	Enabled     bool
}

type LogConfig struct {
	Level  string
	Format string
}

func Load() (*Config, error) {
	v := viper.New()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	setDefaults(v)

	cfg := &Config{
		App: AppConfig{
			Env:     v.GetString("APP_ENV"),
			Name:    v.GetString("APP_NAME"),
			Version: v.GetString("APP_VERSION"),
		},
		HTTP: HTTPConfig{
			Port:            v.GetInt("HTTP_PORT"),
			ReadTimeout:     v.GetDuration("HTTP_READ_TIMEOUT"),
			WriteTimeout:    v.GetDuration("HTTP_WRITE_TIMEOUT"),
			IdleTimeout:     v.GetDuration("HTTP_IDLE_TIMEOUT"),
			ShutdownTimeout: v.GetDuration("HTTP_SHUTDOWN_TIMEOUT"),
			TrustedProxies:  v.GetStringSlice("HTTP_TRUSTED_PROXIES"),
			CORSOrigins:     v.GetStringSlice("HTTP_CORS_ORIGINS"),
		},
		DB: DBConfig{
			Host:     v.GetString("DB_HOST"),
			Port:     v.GetInt("DB_PORT"),
			Name:     v.GetString("DB_NAME"),
			User:     v.GetString("DB_USER"),
			Password: v.GetString("DB_PASSWORD"),
			SSLMode:  v.GetString("DB_SSLMODE"),
			MaxConns: v.GetInt("DB_MAX_CONNS"),
			MinConns: v.GetInt("DB_MIN_CONNS"),
		},
		Redis: RedisConfig{
			Addr:     v.GetString("REDIS_ADDR"),
			Password: v.GetString("REDIS_PASSWORD"),
			DB:       v.GetInt("REDIS_DB"),
			PoolSize: v.GetInt("REDIS_POOL_SIZE"),
			TLS:      v.GetBool("REDIS_TLS"),
		},
		Auth: AuthConfig{
			JWTPublicKeyPath: v.GetString("AUTH_JWT_PUBLIC_KEY_PATH"),
			JWTIssuer:        v.GetString("AUTH_JWT_ISSUER"),
			JWTAudience:      v.GetString("AUTH_JWT_AUDIENCE"),
			JWTClockSkew:     v.GetDuration("AUTH_JWT_CLOCK_SKEW"),
			TokenCacheTTL:    v.GetDuration("AUTH_TOKEN_CACHE_TTL"),
		},
		Kafka: KafkaConfig{
			Brokers:              v.GetStringSlice("KAFKA_BROKERS"),
			TopicFlagSubmissions: v.GetString("KAFKA_TOPIC_FLAG_SUBMISSIONS"),
			UseTLS:               v.GetBool("KAFKA_USE_TLS"),
			Acks:                 v.GetString("KAFKA_ACKS"),
		},
		Vault: VaultConfig{
			Addr:            v.GetString("VAULT_ADDR"),
			TokenPath:       v.GetString("VAULT_TOKEN_PATH"),
			Token:           v.GetString("VAULT_TOKEN"),
			FlagSecretsPath: v.GetString("VAULT_FLAG_SECRETS_PATH"),
			RefreshInterval: v.GetDuration("VAULT_REFRESH_INTERVAL"),
			Enabled:         v.GetBool("VAULT_ENABLED"),
		},
		RateLimit: RateLimitConfig{
			PerContentPerMin:  v.GetInt("RL_PER_CONTENT_PER_MIN"),
			PerUserPerMin:     v.GetInt("RL_PER_USER_PER_MIN"),
			PerIPPerMin:       v.GetInt("RL_PER_IP_PER_MIN"),
			CooldownSeconds:   v.GetInt("RL_COOLDOWN_SECONDS"),
			IPCooldownSeconds: v.GetInt("RL_IP_COOLDOWN_SECONDS"),
			WindowSeconds:     v.GetInt("RL_WINDOW_SECONDS"),
		},
		Idempotency: IdempotencyConfig{
			TTLSeconds: v.GetInt("IDEMPOTENCY_TTL_SECONDS"),
			Enabled:    v.GetBool("IDEMPOTENCY_ENABLED"),
		},
		FlagFormat: FlagFormatConfig{
			Prefix:    v.GetString("FLAG_PREFIX"),
			Suffix:    v.GetString("FLAG_SUFFIX"),
			HMACBytes: v.GetInt("FLAG_HMAC_BYTES"),
			MaxLength: v.GetInt("FLAG_MAX_LENGTH"),
		},
		Orchestrator: OrchestratorConfig{
			GRPCAddr:    v.GetString("ORCHESTRATOR_GRPC_ADDR"),
			GRPCTimeout: v.GetDuration("ORCHESTRATOR_GRPC_TIMEOUT"),
			Enabled:     v.GetBool("ORCHESTRATOR_ENABLED"),
		},
		Log: LogConfig{
			Level:  v.GetString("LOG_LEVEL"),
			Format: v.GetString("LOG_FORMAT"),
		},
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("APP_NAME", "flag-verifier")
	v.SetDefault("APP_VERSION", "0.1.0")

	v.SetDefault("HTTP_PORT", 8005)
	v.SetDefault("HTTP_READ_TIMEOUT", "10s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "10s")
	v.SetDefault("HTTP_IDLE_TIMEOUT", "60s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "30s")
	v.SetDefault("HTTP_CORS_ORIGINS", []string{"http://localhost:3000"})

	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", 5432)
	v.SetDefault("DB_NAME", "offcon")
	v.SetDefault("DB_USER", "svc_flag_verifier")
	v.SetDefault("DB_SSLMODE", "disable")
	v.SetDefault("DB_MAX_CONNS", 25)
	v.SetDefault("DB_MIN_CONNS", 5)

	v.SetDefault("REDIS_ADDR", "localhost:6379")
	v.SetDefault("REDIS_DB", 0)
	v.SetDefault("REDIS_POOL_SIZE", 20)

	v.SetDefault("AUTH_JWT_ISSUER", "https://auth.offensiveconditions.org")
	v.SetDefault("AUTH_JWT_AUDIENCE", "offcon-api")
	v.SetDefault("AUTH_JWT_CLOCK_SKEW", "5s")
	v.SetDefault("AUTH_TOKEN_CACHE_TTL", "30s")

	v.SetDefault("KAFKA_BROKERS", []string{"localhost:9092"})
	v.SetDefault("KAFKA_TOPIC_FLAG_SUBMISSIONS", "flag.submissions")
	v.SetDefault("KAFKA_ACKS", "all")

	v.SetDefault("VAULT_ENABLED", false)
	v.SetDefault("VAULT_ADDR", "http://localhost:8200")
	v.SetDefault("VAULT_FLAG_SECRETS_PATH", "secret/flag-hmac")
	v.SetDefault("VAULT_REFRESH_INTERVAL", "5m")

	v.SetDefault("RL_PER_CONTENT_PER_MIN", 10)
	v.SetDefault("RL_PER_USER_PER_MIN", 100)
	v.SetDefault("RL_PER_IP_PER_MIN", 200)
	v.SetDefault("RL_COOLDOWN_SECONDS", 60)
	v.SetDefault("RL_IP_COOLDOWN_SECONDS", 300)
	v.SetDefault("RL_WINDOW_SECONDS", 60)

	v.SetDefault("IDEMPOTENCY_TTL_SECONDS", 60)
	v.SetDefault("IDEMPOTENCY_ENABLED", true)

	v.SetDefault("FLAG_PREFIX", "OFFCON{")
	v.SetDefault("FLAG_SUFFIX", "}")
	v.SetDefault("FLAG_HMAC_BYTES", 16)
	v.SetDefault("FLAG_MAX_LENGTH", 256)

	v.SetDefault("ORCHESTRATOR_GRPC_ADDR", "orchestrator:9001")
	v.SetDefault("ORCHESTRATOR_GRPC_TIMEOUT", "2s")
	v.SetDefault("ORCHESTRATOR_ENABLED", false)

	v.SetDefault("LOG_LEVEL", "info")
	v.SetDefault("LOG_FORMAT", "json")
}

func (c *Config) Validate() error {
	if c.App.Env == "" {
		return fmt.Errorf("APP_ENV is required")
	}
	if c.App.IsProduction() {
		if c.DB.Password == "" {
			return fmt.Errorf("DB_PASSWORD is required in production")
		}
		if c.DB.SSLMode == "disable" {
			return fmt.Errorf("DB_SSLMODE must not be disable in production")
		}
		if !c.Vault.Enabled {
			return fmt.Errorf("VAULT_ENABLED must be true in production")
		}
	}
	if c.FlagFormat.HMACBytes < 8 || c.FlagFormat.HMACBytes > 32 {
		return fmt.Errorf("FLAG_HMAC_BYTES must be between 8 and 32")
	}
	if c.RateLimit.WindowSeconds <= 0 {
		return fmt.Errorf("RL_WINDOW_SECONDS must be positive")
	}
	return nil
}
