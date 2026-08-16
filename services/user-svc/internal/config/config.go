package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App     AppConfig
	HTTP    HTTPConfig
	GRPC    GRPCConfig
	DB      DBConfig
	Redis   RedisConfig
	Auth    AuthConfig
	Kafka   KafkaConfig
	Storage StorageConfig
	Limits  LimitsConfig
	GDPR    GDPRConfig
	Worker  WorkerConfig
	Log     LogConfig
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
	MaxAvatarBytes  int64
}

type GRPCConfig struct {
	Port             int
	EnableReflection bool
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
	Brokers           []string
	ConsumerGroup     string
	TopicUserEvents   string
	TopicAuthEvents   string
	UseTLS            bool
}

type StorageConfig struct {
	Endpoint     string
	AccessKey    string
	SecretKey    string
	UseSSL       bool
	Region       string
	AvatarBucket string
	ExportBucket string
	CDNBaseURL   string
}

type LimitsConfig struct {
	UsernameMinLength    int
	UsernameMaxLength    int
	BioMaxLength         int
	MaxFriendsFree       int
	MaxFriendsPro        int
	MaxTeamSizeFree      int
	MaxTeamSizePro       int
	MaxTeamsPerUser      int
	InvitationTTL        time.Duration
	FriendRequestTTL     time.Duration
}

type GDPRConfig struct {
	DeletionGracePeriod time.Duration
	ExportTTL           time.Duration
	ExportSignedURLTTL  time.Duration
}

type WorkerConfig struct {
	Concurrency  int
	MaxRetries   int
	RetryBackoff time.Duration
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
			MaxAvatarBytes:  v.GetInt64("HTTP_MAX_AVATAR_BYTES"),
		},
		GRPC: GRPCConfig{
			Port:             v.GetInt("GRPC_PORT"),
			EnableReflection: v.GetBool("GRPC_ENABLE_REFLECTION"),
		},
		DB: DBConfig{
			Host: v.GetString("DB_HOST"), Port: v.GetInt("DB_PORT"),
			Name: v.GetString("DB_NAME"), User: v.GetString("DB_USER"),
			Password: v.GetString("DB_PASSWORD"), SSLMode: v.GetString("DB_SSLMODE"),
			MaxConns: v.GetInt("DB_MAX_CONNS"), MinConns: v.GetInt("DB_MIN_CONNS"),
		},
		Redis: RedisConfig{
			Addr: v.GetString("REDIS_ADDR"), Password: v.GetString("REDIS_PASSWORD"),
			DB: v.GetInt("REDIS_DB"), PoolSize: v.GetInt("REDIS_POOL_SIZE"),
			TLS: v.GetBool("REDIS_TLS"),
		},
		Auth: AuthConfig{
			JWTPublicKeyPath: v.GetString("AUTH_JWT_PUBLIC_KEY_PATH"),
			JWTIssuer:        v.GetString("AUTH_JWT_ISSUER"),
			JWTAudience:      v.GetString("AUTH_JWT_AUDIENCE"),
			JWTClockSkew:     v.GetDuration("AUTH_JWT_CLOCK_SKEW"),
			TokenCacheTTL:    v.GetDuration("AUTH_TOKEN_CACHE_TTL"),
		},
		Kafka: KafkaConfig{
			Brokers:         v.GetStringSlice("KAFKA_BROKERS"),
			ConsumerGroup:   v.GetString("KAFKA_CONSUMER_GROUP"),
			TopicUserEvents: v.GetString("KAFKA_TOPIC_USER_EVENTS"),
			TopicAuthEvents: v.GetString("KAFKA_TOPIC_AUTH_EVENTS"),
			UseTLS:          v.GetBool("KAFKA_USE_TLS"),
		},
		Storage: StorageConfig{
			Endpoint: v.GetString("STORAGE_ENDPOINT"), AccessKey: v.GetString("STORAGE_ACCESS_KEY"),
			SecretKey: v.GetString("STORAGE_SECRET_KEY"), UseSSL: v.GetBool("STORAGE_USE_SSL"),
			Region: v.GetString("STORAGE_REGION"),
			AvatarBucket: v.GetString("STORAGE_AVATAR_BUCKET"),
			ExportBucket: v.GetString("STORAGE_EXPORT_BUCKET"),
			CDNBaseURL:   v.GetString("STORAGE_CDN_BASE_URL"),
		},
		Limits: LimitsConfig{
			UsernameMinLength: v.GetInt("LIMIT_USERNAME_MIN_LENGTH"),
			UsernameMaxLength: v.GetInt("LIMIT_USERNAME_MAX_LENGTH"),
			BioMaxLength:      v.GetInt("LIMIT_BIO_MAX_LENGTH"),
			MaxFriendsFree:    v.GetInt("LIMIT_MAX_FRIENDS_FREE"),
			MaxFriendsPro:     v.GetInt("LIMIT_MAX_FRIENDS_PRO"),
			MaxTeamSizeFree:   v.GetInt("LIMIT_MAX_TEAM_SIZE_FREE"),
			MaxTeamSizePro:    v.GetInt("LIMIT_MAX_TEAM_SIZE_PRO"),
			MaxTeamsPerUser:   v.GetInt("LIMIT_MAX_TEAMS_PER_USER"),
			InvitationTTL:    v.GetDuration("LIMIT_INVITATION_TTL"),
			FriendRequestTTL: v.GetDuration("LIMIT_FRIEND_REQUEST_TTL"),
		},
		GDPR: GDPRConfig{
			DeletionGracePeriod: v.GetDuration("GDPR_DELETION_GRACE_PERIOD"),
			ExportTTL:           v.GetDuration("GDPR_EXPORT_TTL"),
			ExportSignedURLTTL:  v.GetDuration("GDPR_EXPORT_SIGNED_URL_TTL"),
		},
		Worker: WorkerConfig{
			Concurrency:  v.GetInt("WORKER_CONCURRENCY"),
			MaxRetries:   v.GetInt("WORKER_MAX_RETRIES"),
			RetryBackoff: v.GetDuration("WORKER_RETRY_BACKOFF"),
		},
		Log: LogConfig{Level: v.GetString("LOG_LEVEL"), Format: v.GetString("LOG_FORMAT")},
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("APP_NAME", "user-svc")
	v.SetDefault("APP_VERSION", "0.1.0")

	v.SetDefault("HTTP_PORT", 8001)
	v.SetDefault("HTTP_READ_TIMEOUT", "15s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "30s")
	v.SetDefault("HTTP_IDLE_TIMEOUT", "60s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "30s")
	v.SetDefault("HTTP_CORS_ORIGINS", []string{"http://localhost:3000"})
	v.SetDefault("HTTP_MAX_AVATAR_BYTES", 2*1024*1024) // 2 MiB

	v.SetDefault("GRPC_PORT", 9001)
	v.SetDefault("GRPC_ENABLE_REFLECTION", true)

	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", 5432)
	v.SetDefault("DB_NAME", "offcon")
	v.SetDefault("DB_USER", "svc_user")
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
	v.SetDefault("KAFKA_CONSUMER_GROUP", "user-svc")
	v.SetDefault("KAFKA_TOPIC_USER_EVENTS", "user.events")
	v.SetDefault("KAFKA_TOPIC_AUTH_EVENTS", "auth.events")

	v.SetDefault("STORAGE_ENDPOINT", "localhost:9000")
	v.SetDefault("STORAGE_REGION", "us-east-1")
	v.SetDefault("STORAGE_AVATAR_BUCKET", "offcon-avatars")
	v.SetDefault("STORAGE_EXPORT_BUCKET", "offcon-gdpr-exports")

	v.SetDefault("LIMIT_USERNAME_MIN_LENGTH", 3)
	v.SetDefault("LIMIT_USERNAME_MAX_LENGTH", 32)
	v.SetDefault("LIMIT_BIO_MAX_LENGTH", 500)
	v.SetDefault("LIMIT_MAX_FRIENDS_FREE", 100)
	v.SetDefault("LIMIT_MAX_FRIENDS_PRO", 1000)
	v.SetDefault("LIMIT_MAX_TEAM_SIZE_FREE", 5)
	v.SetDefault("LIMIT_MAX_TEAM_SIZE_PRO", 25)
	v.SetDefault("LIMIT_MAX_TEAMS_PER_USER", 5)
	v.SetDefault("LIMIT_INVITATION_TTL", "168h") // 7 days
	v.SetDefault("LIMIT_FRIEND_REQUEST_TTL", "720h") // 30 days

	v.SetDefault("GDPR_DELETION_GRACE_PERIOD", "720h")  // 30 days
	v.SetDefault("GDPR_EXPORT_TTL", "168h")             // 7 days
	v.SetDefault("GDPR_EXPORT_SIGNED_URL_TTL", "24h")

	v.SetDefault("WORKER_CONCURRENCY", 4)
	v.SetDefault("WORKER_MAX_RETRIES", 5)
	v.SetDefault("WORKER_RETRY_BACKOFF", "500ms")

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
		if c.Storage.AccessKey == "" || c.Storage.SecretKey == "" {
			return fmt.Errorf("STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required in production")
		}
	}
	if c.Limits.UsernameMinLength < 2 {
		return fmt.Errorf("LIMIT_USERNAME_MIN_LENGTH must be at least 2")
	}
	if c.Limits.UsernameMaxLength > 64 {
		return fmt.Errorf("LIMIT_USERNAME_MAX_LENGTH must be at most 64")
	}
	if c.Limits.MaxTeamSizeFree > c.Limits.MaxTeamSizePro {
		return fmt.Errorf("free tier team size cannot exceed pro tier")
	}
	return nil
}
