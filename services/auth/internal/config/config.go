package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all service configuration.
// Loaded from environment variables (12-factor app).
type Config struct {
	App       AppConfig
	HTTP      HTTPConfig
	GRPC      GRPCConfig
	DB        DBConfig
	Redis     RedisConfig
	JWT       JWTConfig
	Argon2    Argon2Config
	OAuth     OAuthConfig
	SMTP      SMTPConfig
	RateLimit RateLimitConfig
	Log       LogConfig
	Security  SecurityConfig
}

type AppConfig struct {
	Env     string // development|staging|production
	Name    string
	Version string
}

func (a AppConfig) IsProduction() bool { return a.Env == "production" }
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

type GRPCConfig struct {
	Port            int
	TLSCertPath     string
	TLSKeyPath      string
	ClientCAPath    string // For mTLS — verify caller certs
	EnableReflection bool  // Disable in production
}

type DBConfig struct {
	Host            string
	Port            int
	Name            string
	User            string
	Password        string
	SSLMode         string
	MaxConns        int
	MinConns        int
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
	ConnectTimeout  time.Duration
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

type JWTConfig struct {
	PrivateKeyPath  string
	PublicKeyPath   string
	Issuer          string
	Audience        string
	AccessTTL       time.Duration
	RefreshTTL      time.Duration
	ClockSkew       time.Duration
}

type Argon2Config struct {
	Time    uint32 // Iterations
	Memory  uint32 // KB
	Threads uint8
	KeyLen  uint32
	SaltLen uint32
}

type OAuthConfig struct {
	Providers     map[string]OAuthProviderConfig
	CallbackBase  string // e.g. https://auth.offensiveconditions.org/v1/auth/oauth
	StateSecret   string // For signing state param
	StateTTL      time.Duration
}

type OAuthProviderConfig struct {
	Enabled      bool
	ClientID     string
	ClientSecret string
	Scopes       []string
}

type SMTPConfig struct {
	Host         string
	Port         int
	User         string
	Password     string
	From         string
	FromName     string
	UseTLS       bool
	TemplatesDir string
}

type RateLimitConfig struct {
	LoginPerMinute       int
	RegisterPerHour      int
	PasswordResetPerHour int
	EmailVerifyPerHour   int
	SubmissionPerMinute  int
}

type LogConfig struct {
	Level  string // debug|info|warn|error
	Format string // json|console
}

type SecurityConfig struct {
	FailedLoginsBeforeLock  int
	AccountLockDuration     time.Duration
	EmailVerificationRequired bool
	EmailVerifyTokenTTL     time.Duration
	PasswordResetTokenTTL   time.Duration
	SessionTTL              time.Duration
	BackupCodesCount        int
	MinPasswordLength       int
}

// Load reads configuration from environment variables.
// In production, sensitive values come from Vault via env injection.
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
		GRPC: GRPCConfig{
			Port:             v.GetInt("GRPC_PORT"),
			TLSCertPath:      v.GetString("GRPC_TLS_CERT_PATH"),
			TLSKeyPath:       v.GetString("GRPC_TLS_KEY_PATH"),
			ClientCAPath:     v.GetString("GRPC_CLIENT_CA_PATH"),
			EnableReflection: v.GetBool("GRPC_ENABLE_REFLECTION"),
		},
		DB: DBConfig{
			Host:            v.GetString("DB_HOST"),
			Port:            v.GetInt("DB_PORT"),
			Name:            v.GetString("DB_NAME"),
			User:            v.GetString("DB_USER"),
			Password:        v.GetString("DB_PASSWORD"),
			SSLMode:         v.GetString("DB_SSLMODE"),
			MaxConns:        v.GetInt("DB_MAX_CONNS"),
			MinConns:        v.GetInt("DB_MIN_CONNS"),
			MaxConnLifetime: v.GetDuration("DB_MAX_CONN_LIFETIME"),
			MaxConnIdleTime: v.GetDuration("DB_MAX_CONN_IDLE_TIME"),
			ConnectTimeout:  v.GetDuration("DB_CONNECT_TIMEOUT"),
		},
		Redis: RedisConfig{
			Addr:     v.GetString("REDIS_ADDR"),
			Password: v.GetString("REDIS_PASSWORD"),
			DB:       v.GetInt("REDIS_DB"),
			PoolSize: v.GetInt("REDIS_POOL_SIZE"),
			TLS:      v.GetBool("REDIS_TLS"),
		},
		JWT: JWTConfig{
			PrivateKeyPath: v.GetString("JWT_PRIVATE_KEY_PATH"),
			PublicKeyPath:  v.GetString("JWT_PUBLIC_KEY_PATH"),
			Issuer:         v.GetString("JWT_ISSUER"),
			Audience:       v.GetString("JWT_AUDIENCE"),
			AccessTTL:      v.GetDuration("JWT_ACCESS_TTL"),
			RefreshTTL:     v.GetDuration("JWT_REFRESH_TTL"),
			ClockSkew:      v.GetDuration("JWT_CLOCK_SKEW"),
		},
		Argon2: Argon2Config{
			Time:    uint32(v.GetInt("ARGON2_TIME")),
			Memory:  uint32(v.GetInt("ARGON2_MEMORY")),
			Threads: uint8(v.GetInt("ARGON2_THREADS")),
			KeyLen:  uint32(v.GetInt("ARGON2_KEY_LEN")),
			SaltLen: uint32(v.GetInt("ARGON2_SALT_LEN")),
		},
		OAuth: OAuthConfig{
			CallbackBase: v.GetString("OAUTH_CALLBACK_BASE"),
			StateSecret:  v.GetString("OAUTH_STATE_SECRET"),
			StateTTL:     v.GetDuration("OAUTH_STATE_TTL"),
			Providers: map[string]OAuthProviderConfig{
				"google": {
					Enabled:      v.GetBool("OAUTH_GOOGLE_ENABLED"),
					ClientID:     v.GetString("OAUTH_GOOGLE_CLIENT_ID"),
					ClientSecret: v.GetString("OAUTH_GOOGLE_CLIENT_SECRET"),
					Scopes:       []string{"openid", "email", "profile"},
				},
				"github": {
					Enabled:      v.GetBool("OAUTH_GITHUB_ENABLED"),
					ClientID:     v.GetString("OAUTH_GITHUB_CLIENT_ID"),
					ClientSecret: v.GetString("OAUTH_GITHUB_CLIENT_SECRET"),
					Scopes:       []string{"read:user", "user:email"},
				},
				"discord": {
					Enabled:      v.GetBool("OAUTH_DISCORD_ENABLED"),
					ClientID:     v.GetString("OAUTH_DISCORD_CLIENT_ID"),
					ClientSecret: v.GetString("OAUTH_DISCORD_CLIENT_SECRET"),
					Scopes:       []string{"identify", "email"},
				},
			},
		},
		SMTP: SMTPConfig{
			Host:         v.GetString("SMTP_HOST"),
			Port:         v.GetInt("SMTP_PORT"),
			User:         v.GetString("SMTP_USER"),
			Password:     v.GetString("SMTP_PASSWORD"),
			From:         v.GetString("SMTP_FROM"),
			FromName:     v.GetString("SMTP_FROM_NAME"),
			UseTLS:       v.GetBool("SMTP_USE_TLS"),
			TemplatesDir: v.GetString("SMTP_TEMPLATES_DIR"),
		},
		RateLimit: RateLimitConfig{
			LoginPerMinute:       v.GetInt("RATE_LIMIT_LOGIN_PER_MINUTE"),
			RegisterPerHour:      v.GetInt("RATE_LIMIT_REGISTER_PER_HOUR"),
			PasswordResetPerHour: v.GetInt("RATE_LIMIT_PASSWORD_RESET_PER_HOUR"),
			EmailVerifyPerHour:   v.GetInt("RATE_LIMIT_EMAIL_VERIFY_PER_HOUR"),
		},
		Log: LogConfig{
			Level:  v.GetString("LOG_LEVEL"),
			Format: v.GetString("LOG_FORMAT"),
		},
		Security: SecurityConfig{
			FailedLoginsBeforeLock:    v.GetInt("SEC_FAILED_LOGINS_BEFORE_LOCK"),
			AccountLockDuration:       v.GetDuration("SEC_ACCOUNT_LOCK_DURATION"),
			EmailVerificationRequired: v.GetBool("SEC_EMAIL_VERIFICATION_REQUIRED"),
			EmailVerifyTokenTTL:       v.GetDuration("SEC_EMAIL_VERIFY_TOKEN_TTL"),
			PasswordResetTokenTTL:     v.GetDuration("SEC_PASSWORD_RESET_TOKEN_TTL"),
			SessionTTL:                v.GetDuration("SEC_SESSION_TTL"),
			BackupCodesCount:          v.GetInt("SEC_BACKUP_CODES_COUNT"),
			MinPasswordLength:         v.GetInt("SEC_MIN_PASSWORD_LENGTH"),
		},
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("APP_NAME", "auth")
	v.SetDefault("APP_VERSION", "0.1.0")

	v.SetDefault("HTTP_PORT", 8001)
	v.SetDefault("HTTP_READ_TIMEOUT", "10s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "10s")
	v.SetDefault("HTTP_IDLE_TIMEOUT", "60s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "30s")
	v.SetDefault("HTTP_TRUSTED_PROXIES", []string{"127.0.0.1"})
	v.SetDefault("HTTP_CORS_ORIGINS", []string{"http://localhost:3000"})

	v.SetDefault("GRPC_PORT", 9001)
	v.SetDefault("GRPC_ENABLE_REFLECTION", true)

	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", 5432)
	v.SetDefault("DB_NAME", "offcon")
	v.SetDefault("DB_USER", "svc_auth")
	v.SetDefault("DB_SSLMODE", "disable")
	v.SetDefault("DB_MAX_CONNS", 25)
	v.SetDefault("DB_MIN_CONNS", 5)
	v.SetDefault("DB_MAX_CONN_LIFETIME", "1h")
	v.SetDefault("DB_MAX_CONN_IDLE_TIME", "15m")
	v.SetDefault("DB_CONNECT_TIMEOUT", "10s")

	v.SetDefault("REDIS_ADDR", "localhost:6379")
	v.SetDefault("REDIS_DB", 0)
	v.SetDefault("REDIS_POOL_SIZE", 10)

	v.SetDefault("JWT_ISSUER", "https://auth.offensiveconditions.org")
	v.SetDefault("JWT_AUDIENCE", "offcon-api")
	v.SetDefault("JWT_ACCESS_TTL", "15m")
	v.SetDefault("JWT_REFRESH_TTL", "168h") // 7 days
	v.SetDefault("JWT_CLOCK_SKEW", "5s")

	v.SetDefault("ARGON2_TIME", 2)
	v.SetDefault("ARGON2_MEMORY", 65536) // 64 MB
	v.SetDefault("ARGON2_THREADS", 1)
	v.SetDefault("ARGON2_KEY_LEN", 32)
	v.SetDefault("ARGON2_SALT_LEN", 16)

	v.SetDefault("OAUTH_CALLBACK_BASE", "http://localhost:8001/v1/auth/oauth")
	v.SetDefault("OAUTH_STATE_TTL", "10m")

	v.SetDefault("SMTP_PORT", 587)
	v.SetDefault("SMTP_USE_TLS", true)
	v.SetDefault("SMTP_FROM_NAME", "Offensive Conditions")
	v.SetDefault("SMTP_TEMPLATES_DIR", "./templates/email")

	v.SetDefault("RATE_LIMIT_LOGIN_PER_MINUTE", 10)
	v.SetDefault("RATE_LIMIT_REGISTER_PER_HOUR", 5)
	v.SetDefault("RATE_LIMIT_PASSWORD_RESET_PER_HOUR", 3)
	v.SetDefault("RATE_LIMIT_EMAIL_VERIFY_PER_HOUR", 5)

	v.SetDefault("LOG_LEVEL", "info")
	v.SetDefault("LOG_FORMAT", "json")

	v.SetDefault("SEC_FAILED_LOGINS_BEFORE_LOCK", 5)
	v.SetDefault("SEC_ACCOUNT_LOCK_DURATION", "15m")
	v.SetDefault("SEC_EMAIL_VERIFICATION_REQUIRED", true)
	v.SetDefault("SEC_EMAIL_VERIFY_TOKEN_TTL", "24h")
	v.SetDefault("SEC_PASSWORD_RESET_TOKEN_TTL", "1h")
	v.SetDefault("SEC_SESSION_TTL", "168h") // 7 days
	v.SetDefault("SEC_BACKUP_CODES_COUNT", 10)
	v.SetDefault("SEC_MIN_PASSWORD_LENGTH", 12)
}

func (c *Config) Validate() error {
	if c.App.Env == "" {
		return fmt.Errorf("APP_ENV is required")
	}
	if c.DB.Password == "" && c.App.IsProduction() {
		return fmt.Errorf("DB_PASSWORD is required in production")
	}
	if c.JWT.PrivateKeyPath == "" {
		return fmt.Errorf("JWT_PRIVATE_KEY_PATH is required")
	}
	if c.JWT.PublicKeyPath == "" {
		return fmt.Errorf("JWT_PUBLIC_KEY_PATH is required")
	}
	if c.JWT.AccessTTL >= c.JWT.RefreshTTL {
		return fmt.Errorf("JWT_ACCESS_TTL must be less than JWT_REFRESH_TTL")
	}
	if c.Security.MinPasswordLength < 8 {
		return fmt.Errorf("SEC_MIN_PASSWORD_LENGTH must be at least 8")
	}
	if c.App.IsProduction() && c.GRPC.EnableReflection {
		return fmt.Errorf("GRPC_ENABLE_REFLECTION must be false in production")
	}
	if c.App.IsProduction() && c.DB.SSLMode == "disable" {
		return fmt.Errorf("DB_SSLMODE must not be 'disable' in production")
	}
	return nil
}
