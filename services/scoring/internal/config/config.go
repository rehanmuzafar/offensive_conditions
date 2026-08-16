package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App        AppConfig
	HTTP       HTTPConfig
	GRPC       GRPCConfig
	DB         DBConfig
	Redis      RedisConfig
	ClickHouse ClickHouseConfig
	Auth       AuthConfig
	Kafka      KafkaConfig
	Points     PointsConfig
	ELO        ELOConfig
	Season     SeasonConfig
	Streak     StreakConfig
	AntiCheat  AntiCheatConfig
	Worker     WorkerConfig
	Log        LogConfig
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

type ClickHouseConfig struct {
	Addrs    []string
	Database string
	Username string
	Password string
	UseTLS   bool
	Enabled  bool
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
	ConsumerGroup        string
	TopicFlagSubmissions string                       // consume
	TopicCTFEvents       string                       // consume
	TopicUserEvents      string                       // produce (badge awarded, rank up)
	UseTLS               bool
}

// PointsConfig controls the point calculation formula.
type PointsConfig struct {
	// Base points per difficulty level
	BasePointsVeryEasy int
	BasePointsEasy     int
	BasePointsMedium   int
	BasePointsHard     int
	BasePointsInsane   int

	// Flag share split (must sum to 1.0)
	UserFlagShare float64 // default 0.30
	RootFlagShare float64 // default 0.70

	// First-blood multipliers
	FirstBloodMult  float64 // 1.5
	SecondBloodMult float64 // 1.25
	ThirdBloodMult  float64 // 1.10

	// Time decay
	TimeDecayDays  int     // 365 → fully decayed
	TimeDecayFloor float64 // 0.50 → never below 50%
}

// ELOConfig controls the ELO rating system.
type ELOConfig struct {
	InitialRating      int
	KFactorDefault     int // 32
	KFactorHigh        int // 16 for high-rated
	HighRatingThreshold int // 2400
	ProvisionalMatches int // 10 (volatile K during onboarding)
	KFactorProvisional int // 40
	InactivityDays     int // 60 → start decaying
	DecayPerCycle      int // 25 rating per decay cycle
}

// SeasonConfig controls season rollovers.
type SeasonConfig struct {
	DurationDays       int     // 90
	CarryoverFraction  float64 // 0.25
	RolloverGracePeriod time.Duration // 24h grace before forcing
}

// StreakConfig controls daily streak rules.
type StreakConfig struct {
	GraceMinutes int // how many minutes after midnight UTC still count
	BonusEvery   int // bonus points every N days
	BonusPoints  int
}

type AntiCheatConfig struct {
	EnableSpeedCheck     bool
	MinSolveSeconds      int     // implausibly fast
	EnableSharedFlagCheck bool
	EnableIPChangeCheck  bool
}

type WorkerConfig struct {
	Concurrency      int
	BatchSize        int
	MaxRetries       int
	RetryBackoff     time.Duration
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
			Env: v.GetString("APP_ENV"), Name: v.GetString("APP_NAME"), Version: v.GetString("APP_VERSION"),
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
			Port: v.GetInt("GRPC_PORT"), EnableReflection: v.GetBool("GRPC_ENABLE_REFLECTION"),
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
		ClickHouse: ClickHouseConfig{
			Addrs:    v.GetStringSlice("CLICKHOUSE_ADDRS"),
			Database: v.GetString("CLICKHOUSE_DATABASE"),
			Username: v.GetString("CLICKHOUSE_USERNAME"),
			Password: v.GetString("CLICKHOUSE_PASSWORD"),
			UseTLS:   v.GetBool("CLICKHOUSE_TLS"),
			Enabled:  v.GetBool("CLICKHOUSE_ENABLED"),
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
			ConsumerGroup:        v.GetString("KAFKA_CONSUMER_GROUP"),
			TopicFlagSubmissions: v.GetString("KAFKA_TOPIC_FLAG_SUBMISSIONS"),
			TopicCTFEvents:       v.GetString("KAFKA_TOPIC_CTF_EVENTS"),
			TopicUserEvents:      v.GetString("KAFKA_TOPIC_USER_EVENTS"),
			UseTLS:               v.GetBool("KAFKA_USE_TLS"),
		},
		Points: PointsConfig{
			BasePointsVeryEasy: v.GetInt("POINTS_BASE_VERY_EASY"),
			BasePointsEasy:     v.GetInt("POINTS_BASE_EASY"),
			BasePointsMedium:   v.GetInt("POINTS_BASE_MEDIUM"),
			BasePointsHard:     v.GetInt("POINTS_BASE_HARD"),
			BasePointsInsane:   v.GetInt("POINTS_BASE_INSANE"),
			UserFlagShare:      v.GetFloat64("POINTS_USER_FLAG_SHARE"),
			RootFlagShare:      v.GetFloat64("POINTS_ROOT_FLAG_SHARE"),
			FirstBloodMult:     v.GetFloat64("POINTS_FIRST_BLOOD_MULT"),
			SecondBloodMult:    v.GetFloat64("POINTS_SECOND_BLOOD_MULT"),
			ThirdBloodMult:     v.GetFloat64("POINTS_THIRD_BLOOD_MULT"),
			TimeDecayDays:      v.GetInt("POINTS_TIME_DECAY_DAYS"),
			TimeDecayFloor:     v.GetFloat64("POINTS_TIME_DECAY_FLOOR"),
		},
		ELO: ELOConfig{
			InitialRating:       v.GetInt("ELO_INITIAL"),
			KFactorDefault:      v.GetInt("ELO_K_FACTOR"),
			KFactorHigh:         v.GetInt("ELO_K_FACTOR_HIGH"),
			HighRatingThreshold: v.GetInt("ELO_HIGH_THRESHOLD"),
			ProvisionalMatches:  v.GetInt("ELO_PROVISIONAL_MATCHES"),
			KFactorProvisional:  v.GetInt("ELO_K_FACTOR_PROVISIONAL"),
			InactivityDays:      v.GetInt("ELO_INACTIVITY_DAYS"),
			DecayPerCycle:       v.GetInt("ELO_DECAY_PER_CYCLE"),
		},
		Season: SeasonConfig{
			DurationDays:        v.GetInt("SEASON_DURATION_DAYS"),
			CarryoverFraction:   v.GetFloat64("SEASON_CARRYOVER_FRACTION"),
			RolloverGracePeriod: v.GetDuration("SEASON_ROLLOVER_GRACE"),
		},
		Streak: StreakConfig{
			GraceMinutes: v.GetInt("STREAK_GRACE_MINUTES"),
			BonusEvery:   v.GetInt("STREAK_BONUS_EVERY"),
			BonusPoints:  v.GetInt("STREAK_BONUS_POINTS"),
		},
		AntiCheat: AntiCheatConfig{
			EnableSpeedCheck:      v.GetBool("ANTICHEAT_ENABLE_SPEED"),
			MinSolveSeconds:       v.GetInt("ANTICHEAT_MIN_SOLVE_SECONDS"),
			EnableSharedFlagCheck: v.GetBool("ANTICHEAT_ENABLE_SHARED_FLAG"),
			EnableIPChangeCheck:   v.GetBool("ANTICHEAT_ENABLE_IP_CHANGE"),
		},
		Worker: WorkerConfig{
			Concurrency:  v.GetInt("WORKER_CONCURRENCY"),
			BatchSize:    v.GetInt("WORKER_BATCH_SIZE"),
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
	v.SetDefault("APP_NAME", "scoring")
	v.SetDefault("APP_VERSION", "0.1.0")

	v.SetDefault("HTTP_PORT", 8003)
	v.SetDefault("HTTP_READ_TIMEOUT", "15s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "30s")
	v.SetDefault("HTTP_IDLE_TIMEOUT", "60s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "30s")
	v.SetDefault("HTTP_CORS_ORIGINS", []string{"http://localhost:3000"})

	v.SetDefault("GRPC_PORT", 9003)
	v.SetDefault("GRPC_ENABLE_REFLECTION", true)

	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", 5432)
	v.SetDefault("DB_NAME", "offcon")
	v.SetDefault("DB_USER", "svc_scoring")
	v.SetDefault("DB_SSLMODE", "disable")
	v.SetDefault("DB_MAX_CONNS", 25)
	v.SetDefault("DB_MIN_CONNS", 5)

	v.SetDefault("REDIS_ADDR", "localhost:6379")
	v.SetDefault("REDIS_DB", 0)
	v.SetDefault("REDIS_POOL_SIZE", 10)

	v.SetDefault("CLICKHOUSE_ENABLED", false)
	v.SetDefault("CLICKHOUSE_ADDRS", []string{"localhost:9000"})
	v.SetDefault("CLICKHOUSE_DATABASE", "offcon_analytics")
	v.SetDefault("CLICKHOUSE_USERNAME", "default")

	v.SetDefault("AUTH_JWT_ISSUER", "https://auth.offensiveconditions.org")
	v.SetDefault("AUTH_JWT_AUDIENCE", "offcon-api")
	v.SetDefault("AUTH_JWT_CLOCK_SKEW", "5s")
	v.SetDefault("AUTH_TOKEN_CACHE_TTL", "30s")

	v.SetDefault("KAFKA_BROKERS", []string{"localhost:9092"})
	v.SetDefault("KAFKA_CONSUMER_GROUP", "scoring-svc")
	v.SetDefault("KAFKA_TOPIC_FLAG_SUBMISSIONS", "flag.submissions")
	v.SetDefault("KAFKA_TOPIC_CTF_EVENTS", "ctf.events")
	v.SetDefault("KAFKA_TOPIC_USER_EVENTS", "user.events")

	// Points
	v.SetDefault("POINTS_BASE_VERY_EASY", 10)
	v.SetDefault("POINTS_BASE_EASY", 20)
	v.SetDefault("POINTS_BASE_MEDIUM", 30)
	v.SetDefault("POINTS_BASE_HARD", 40)
	v.SetDefault("POINTS_BASE_INSANE", 50)
	v.SetDefault("POINTS_USER_FLAG_SHARE", 0.30)
	v.SetDefault("POINTS_ROOT_FLAG_SHARE", 0.70)
	v.SetDefault("POINTS_FIRST_BLOOD_MULT", 1.50)
	v.SetDefault("POINTS_SECOND_BLOOD_MULT", 1.25)
	v.SetDefault("POINTS_THIRD_BLOOD_MULT", 1.10)
	v.SetDefault("POINTS_TIME_DECAY_DAYS", 365)
	v.SetDefault("POINTS_TIME_DECAY_FLOOR", 0.50)

	// ELO
	v.SetDefault("ELO_INITIAL", 1500)
	v.SetDefault("ELO_K_FACTOR", 32)
	v.SetDefault("ELO_K_FACTOR_HIGH", 16)
	v.SetDefault("ELO_HIGH_THRESHOLD", 2400)
	v.SetDefault("ELO_PROVISIONAL_MATCHES", 10)
	v.SetDefault("ELO_K_FACTOR_PROVISIONAL", 40)
	v.SetDefault("ELO_INACTIVITY_DAYS", 60)
	v.SetDefault("ELO_DECAY_PER_CYCLE", 25)

	// Season
	v.SetDefault("SEASON_DURATION_DAYS", 90)
	v.SetDefault("SEASON_CARRYOVER_FRACTION", 0.25)
	v.SetDefault("SEASON_ROLLOVER_GRACE", "24h")

	// Streak
	v.SetDefault("STREAK_GRACE_MINUTES", 0)
	v.SetDefault("STREAK_BONUS_EVERY", 7)
	v.SetDefault("STREAK_BONUS_POINTS", 50)

	// Anti-cheat
	v.SetDefault("ANTICHEAT_ENABLE_SPEED", true)
	v.SetDefault("ANTICHEAT_MIN_SOLVE_SECONDS", 60)
	v.SetDefault("ANTICHEAT_ENABLE_SHARED_FLAG", true)
	v.SetDefault("ANTICHEAT_ENABLE_IP_CHANGE", true)

	// Worker
	v.SetDefault("WORKER_CONCURRENCY", 4)
	v.SetDefault("WORKER_BATCH_SIZE", 100)
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
	}
	// Flag shares must sum to ~1.0
	totalShare := c.Points.UserFlagShare + c.Points.RootFlagShare
	if totalShare < 0.99 || totalShare > 1.01 {
		return fmt.Errorf("POINTS_USER_FLAG_SHARE + POINTS_ROOT_FLAG_SHARE must equal 1.0 (got %.2f)", totalShare)
	}
	if c.Points.TimeDecayFloor < 0 || c.Points.TimeDecayFloor > 1 {
		return fmt.Errorf("POINTS_TIME_DECAY_FLOOR must be between 0 and 1")
	}
	if c.ELO.InitialRating <= 0 {
		return fmt.Errorf("ELO_INITIAL must be positive")
	}
	return nil
}
