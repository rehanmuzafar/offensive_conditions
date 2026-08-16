package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App       AppConfig
	HTTP      HTTPConfig
	GRPC      GRPCConfig
	DB        DBConfig
	Redis     RedisConfig
	Auth      AuthConfig
	K8s       KubernetesConfig
	Proxmox   ProxmoxConfig
	Network   NetworkConfig
	Flag      FlagConfig
	Lifecycle LifecycleConfig
	Kafka     KafkaConfig
	Quota     QuotaConfig
	Log       LogConfig
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
	TLSCertPath      string
	TLSKeyPath       string
	ClientCAPath     string
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
	GRPCEndpoint        string
	JWTPublicKeyPath    string
	JWTIssuer           string
	JWTAudience         string
	JWTClockSkew        time.Duration
	TLSCertPath         string
	TLSKeyPath          string
	CAPath              string
	Insecure            bool
	TokenCacheTTL       time.Duration
}

type KubernetesConfig struct {
	InCluster       bool
	Kubeconfig      string
	LabNamespace    string
	RuntimeClass    string                  // e.g. "gvisor"
	StorageClass    string                  // e.g. "lab-storage"
	NodeSelector    map[string]string       // e.g. {role: lab}
	Tolerations     []string                // raw "key=value:effect"
	ImagePullSecret string
	CPULimit        string                  // default per pod e.g. "2"
	MemLimit        string                  // default per pod e.g. "4Gi"
	NetworkAttachDef string                 // Multus NetworkAttachmentDefinition name
}

type ProxmoxConfig struct {
	Endpoint     string
	User         string
	TokenID      string
	TokenSecret  string
	DefaultNode  string
	Storage      string
	BridgeName   string                     // VM network bridge
	VerifyTLS    bool
	APITimeout   time.Duration
}

type NetworkConfig struct {
	UserSubnetBase   string                 // 10.10.0.0/16
	UserSubnetSize   int                    // 24 (gives /24 per user)
	InstanceSubnetSize int                  // 30 (per-instance /30)
	WireGuardAPI     string
	WireGuardAPIKey  string
	VPNGatewayIP     string                 // user VPN endpoint
	FirewallAPI      string                 // optional pfSense/OPNsense API
}

type FlagConfig struct {
	HMACSecret string
	Prefix     string                       // OFFCON{...}
}

type LifecycleConfig struct {
	DefaultTTL     time.Duration
	MaxTTL         time.Duration
	ExtendStep     time.Duration            // how much each /extend call adds
	MaxExtensions  int
	ReaperInterval time.Duration
	GraceDuration  time.Duration            // soft warning before kill
	HealthCheckInterval time.Duration
}

type KafkaConfig struct {
	Brokers              []string
	TopicInstanceEvents  string
	TopicFlagSubmissions string
	UseTLS               bool
}

type QuotaConfig struct {
	ConcurrentInstancesFree int
	ConcurrentInstancesPro  int
	MonthlyHoursFree        int
	MonthlyHoursPro         int
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
			Port: v.GetInt("GRPC_PORT"),
			TLSCertPath: v.GetString("GRPC_TLS_CERT_PATH"),
			TLSKeyPath:  v.GetString("GRPC_TLS_KEY_PATH"),
			ClientCAPath: v.GetString("GRPC_CLIENT_CA_PATH"),
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
			GRPCEndpoint:     v.GetString("AUTH_GRPC_ENDPOINT"),
			JWTPublicKeyPath: v.GetString("AUTH_JWT_PUBLIC_KEY_PATH"),
			JWTIssuer:        v.GetString("AUTH_JWT_ISSUER"),
			JWTAudience:      v.GetString("AUTH_JWT_AUDIENCE"),
			JWTClockSkew:     v.GetDuration("AUTH_JWT_CLOCK_SKEW"),
			TLSCertPath:      v.GetString("AUTH_TLS_CERT_PATH"),
			TLSKeyPath:       v.GetString("AUTH_TLS_KEY_PATH"),
			CAPath:           v.GetString("AUTH_CA_PATH"),
			Insecure:         v.GetBool("AUTH_INSECURE"),
			TokenCacheTTL:    v.GetDuration("AUTH_TOKEN_CACHE_TTL"),
		},
		K8s: KubernetesConfig{
			InCluster: v.GetBool("K8S_IN_CLUSTER"), Kubeconfig: v.GetString("K8S_KUBECONFIG"),
			LabNamespace: v.GetString("K8S_LAB_NAMESPACE"),
			RuntimeClass: v.GetString("K8S_RUNTIME_CLASS"),
			StorageClass: v.GetString("K8S_STORAGE_CLASS"),
			NodeSelector: v.GetStringMapString("K8S_NODE_SELECTOR"),
			Tolerations:  v.GetStringSlice("K8S_TOLERATIONS"),
			ImagePullSecret: v.GetString("K8S_IMAGE_PULL_SECRET"),
			CPULimit:     v.GetString("K8S_CPU_LIMIT"),
			MemLimit:     v.GetString("K8S_MEM_LIMIT"),
			NetworkAttachDef: v.GetString("K8S_NETWORK_ATTACH_DEF"),
		},
		Proxmox: ProxmoxConfig{
			Endpoint:    v.GetString("PROXMOX_ENDPOINT"),
			User:        v.GetString("PROXMOX_USER"),
			TokenID:     v.GetString("PROXMOX_TOKEN_ID"),
			TokenSecret: v.GetString("PROXMOX_TOKEN_SECRET"),
			DefaultNode: v.GetString("PROXMOX_DEFAULT_NODE"),
			Storage:     v.GetString("PROXMOX_STORAGE"),
			BridgeName:  v.GetString("PROXMOX_BRIDGE"),
			VerifyTLS:   v.GetBool("PROXMOX_VERIFY_TLS"),
			APITimeout:  v.GetDuration("PROXMOX_API_TIMEOUT"),
		},
		Network: NetworkConfig{
			UserSubnetBase:     v.GetString("NETWORK_USER_SUBNET_BASE"),
			UserSubnetSize:     v.GetInt("NETWORK_USER_SUBNET_SIZE"),
			InstanceSubnetSize: v.GetInt("NETWORK_INSTANCE_SUBNET_SIZE"),
			WireGuardAPI:       v.GetString("WIREGUARD_API"),
			WireGuardAPIKey:    v.GetString("WIREGUARD_API_KEY"),
			VPNGatewayIP:       v.GetString("VPN_GATEWAY_IP"),
			FirewallAPI:        v.GetString("FIREWALL_API"),
		},
		Flag: FlagConfig{
			HMACSecret: v.GetString("FLAG_HMAC_SECRET"),
			Prefix:     v.GetString("FLAG_PREFIX"),
		},
		Lifecycle: LifecycleConfig{
			DefaultTTL:          v.GetDuration("INSTANCE_DEFAULT_TTL"),
			MaxTTL:              v.GetDuration("INSTANCE_MAX_TTL"),
			ExtendStep:          v.GetDuration("INSTANCE_EXTEND_STEP"),
			MaxExtensions:       v.GetInt("INSTANCE_MAX_EXTENSIONS"),
			ReaperInterval:      v.GetDuration("REAPER_INTERVAL"),
			GraceDuration:       v.GetDuration("INSTANCE_GRACE_DURATION"),
			HealthCheckInterval: v.GetDuration("INSTANCE_HEALTH_INTERVAL"),
		},
		Kafka: KafkaConfig{
			Brokers:              v.GetStringSlice("KAFKA_BROKERS"),
			TopicInstanceEvents:  v.GetString("KAFKA_TOPIC_INSTANCE_EVENTS"),
			TopicFlagSubmissions: v.GetString("KAFKA_TOPIC_FLAG_SUBMISSIONS"),
			UseTLS:               v.GetBool("KAFKA_USE_TLS"),
		},
		Quota: QuotaConfig{
			ConcurrentInstancesFree: v.GetInt("QUOTA_CONCURRENT_FREE"),
			ConcurrentInstancesPro:  v.GetInt("QUOTA_CONCURRENT_PRO"),
			MonthlyHoursFree:        v.GetInt("QUOTA_MONTHLY_HOURS_FREE"),
			MonthlyHoursPro:         v.GetInt("QUOTA_MONTHLY_HOURS_PRO"),
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
	v.SetDefault("APP_NAME", "orchestrator")
	v.SetDefault("APP_VERSION", "0.1.0")

	v.SetDefault("HTTP_PORT", 8002)
	v.SetDefault("HTTP_READ_TIMEOUT", "15s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "30s")
	v.SetDefault("HTTP_IDLE_TIMEOUT", "60s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "30s")
	v.SetDefault("HTTP_CORS_ORIGINS", []string{"http://localhost:3000"})

	v.SetDefault("GRPC_PORT", 9002)
	v.SetDefault("GRPC_ENABLE_REFLECTION", true)

	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", 5432)
	v.SetDefault("DB_NAME", "offcon")
	v.SetDefault("DB_USER", "svc_orchestrator")
	v.SetDefault("DB_SSLMODE", "disable")
	v.SetDefault("DB_MAX_CONNS", 25)
	v.SetDefault("DB_MIN_CONNS", 5)

	v.SetDefault("REDIS_ADDR", "localhost:6379")
	v.SetDefault("REDIS_POOL_SIZE", 10)

	v.SetDefault("AUTH_GRPC_ENDPOINT", "localhost:9001")
	v.SetDefault("AUTH_JWT_ISSUER", "https://auth.offensiveconditions.org")
	v.SetDefault("AUTH_JWT_AUDIENCE", "offcon-api")
	v.SetDefault("AUTH_JWT_CLOCK_SKEW", "5s")
	v.SetDefault("AUTH_INSECURE", true)
	v.SetDefault("AUTH_TOKEN_CACHE_TTL", "30s")

	v.SetDefault("K8S_IN_CLUSTER", false)
	v.SetDefault("K8S_LAB_NAMESPACE", "lab-instances")
	v.SetDefault("K8S_RUNTIME_CLASS", "")
	v.SetDefault("K8S_CPU_LIMIT", "2")
	v.SetDefault("K8S_MEM_LIMIT", "4Gi")

	v.SetDefault("PROXMOX_API_TIMEOUT", "30s")
	v.SetDefault("PROXMOX_VERIFY_TLS", true)
	v.SetDefault("PROXMOX_STORAGE", "local-lvm")
	v.SetDefault("PROXMOX_BRIDGE", "vmbr0")

	v.SetDefault("NETWORK_USER_SUBNET_BASE", "10.10.0.0/16")
	v.SetDefault("NETWORK_USER_SUBNET_SIZE", 24)
	v.SetDefault("NETWORK_INSTANCE_SUBNET_SIZE", 30)

	v.SetDefault("FLAG_PREFIX", "OFFCON")

	v.SetDefault("INSTANCE_DEFAULT_TTL", "8h")
	v.SetDefault("INSTANCE_MAX_TTL", "24h")
	v.SetDefault("INSTANCE_EXTEND_STEP", "4h")
	v.SetDefault("INSTANCE_MAX_EXTENSIONS", 3)
	v.SetDefault("REAPER_INTERVAL", "60s")
	v.SetDefault("INSTANCE_GRACE_DURATION", "5m")
	v.SetDefault("INSTANCE_HEALTH_INTERVAL", "30s")

	v.SetDefault("KAFKA_BROKERS", []string{"localhost:9092"})
	v.SetDefault("KAFKA_TOPIC_INSTANCE_EVENTS", "instance.events")
	v.SetDefault("KAFKA_TOPIC_FLAG_SUBMISSIONS", "flag.submissions")

	v.SetDefault("QUOTA_CONCURRENT_FREE", 1)
	v.SetDefault("QUOTA_CONCURRENT_PRO", 4)
	v.SetDefault("QUOTA_MONTHLY_HOURS_FREE", 40)
	v.SetDefault("QUOTA_MONTHLY_HOURS_PRO", 300)

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
		if c.Flag.HMACSecret == "" {
			return fmt.Errorf("FLAG_HMAC_SECRET is required in production")
		}
		if c.Auth.Insecure {
			return fmt.Errorf("AUTH_INSECURE must be false in production")
		}
		if c.DB.SSLMode == "disable" {
			return fmt.Errorf("DB_SSLMODE must not be disable in production")
		}
	}
	if c.Lifecycle.DefaultTTL > c.Lifecycle.MaxTTL {
		return fmt.Errorf("INSTANCE_DEFAULT_TTL cannot exceed INSTANCE_MAX_TTL")
	}
	if c.Network.UserSubnetBase == "" {
		return fmt.Errorf("NETWORK_USER_SUBNET_BASE is required")
	}
	return nil
}
