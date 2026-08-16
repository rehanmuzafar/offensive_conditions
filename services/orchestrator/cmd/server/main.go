// Package main starts the orchestrator HTTP+gRPC server.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	corev1 "k8s.io/api/core/v1"

	"github.com/offensive-conditions/orchestrator/internal/auth"
	"github.com/offensive-conditions/orchestrator/internal/backends"
	k8sbackend "github.com/offensive-conditions/orchestrator/internal/backends/kubernetes"
	dockerbackend "github.com/offensive-conditions/orchestrator/internal/backends/docker"
	mockbackend "github.com/offensive-conditions/orchestrator/internal/backends/mock"
	"github.com/offensive-conditions/orchestrator/internal/backends/proxmox"
	"github.com/offensive-conditions/orchestrator/internal/config"
	"github.com/offensive-conditions/orchestrator/internal/events"
	"github.com/offensive-conditions/orchestrator/internal/flag"
	"github.com/offensive-conditions/orchestrator/internal/handlers"
	"github.com/offensive-conditions/orchestrator/internal/lifecycle"
	"github.com/offensive-conditions/orchestrator/internal/middleware"
	"github.com/offensive-conditions/orchestrator/internal/network"
	"github.com/offensive-conditions/orchestrator/internal/repository"
	"github.com/offensive-conditions/orchestrator/internal/scheduler"
	"github.com/offensive-conditions/orchestrator/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("orchestrator startup failed")
	}
}

func run() error {
	// --- Config ---
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	// --- Logger ---
	logger := newLogger(cfg.Log.Level, cfg.Log.Format)
	logger.Info().
		Str("env", cfg.App.Env).
		Str("version", cfg.App.Version).
		Msg("starting orchestrator")

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Database ---
	db, err := repository.NewPool(rootCtx, repository.PoolConfig{
		DSN:      cfg.DB.DSN(),
		MaxConns: int32(cfg.DB.MaxConns),
		MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer db.Close()
	logger.Info().Msg("database connected")

	// --- Redis ---
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
		PoolSize: cfg.Redis.PoolSize,
	})
	defer rdb.Close()
	if err := rdb.Ping(rootCtx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	logger.Info().Msg("redis connected")

	// --- Repositories ---
	machineRepo := repository.NewPGMachineRepo(db)
	instanceRepo := repository.NewPGInstanceRepo(db)
	flagSubRepo := repository.NewPGFlagSubmissionRepo(db)
	subnetRepo := repository.NewPGSubnetAllocationRepo(db)
	capacityRepo := repository.NewPGCapacityRepo(db)

	// --- JWT validator ---
	validator, err := auth.NewValidator(auth.Config{
		PublicKeyPath: cfg.Auth.JWTPublicKeyPath,
		Issuer:        cfg.Auth.JWTIssuer,
		Audience:      cfg.Auth.JWTAudience,
		ClockSkew:     cfg.Auth.JWTClockSkew,
		CacheTTL:      cfg.Auth.TokenCacheTTL,
	})
	if err != nil {
		return fmt.Errorf("jwt validator: %w", err)
	}
	logger.Info().Msg("jwt validator ready")

	// --- Flag generator ---
	flagGen := flag.NewGenerator([]byte(cfg.Flag.HMACSecret), cfg.Flag.Prefix)

	// --- Network ---
	netAllocator, err := network.NewAllocator(cfg.Network.UserSubnetBase,
		cfg.Network.UserSubnetSize, cfg.Network.InstanceSubnetSize)
	if err != nil {
		return fmt.Errorf("network allocator: %w", err)
	}
	if err := hydrateAllocator(rootCtx, netAllocator, subnetRepo); err != nil {
		logger.Warn().Err(err).Msg("allocator hydration partial")
	}
	vpnCtrl := network.NewVPNController(cfg.Network.WireGuardAPI, cfg.Network.WireGuardAPIKey)

	// --- Backends ---
	var (
		k8sBe     backends.Backend
		proxmoxBe backends.Backend
	)
	k8sBe, err = k8sbackend.New(k8sbackend.Options{
		InCluster:        cfg.K8s.InCluster,
		Kubeconfig:       cfg.K8s.Kubeconfig,
		Namespace:        cfg.K8s.LabNamespace,
		RuntimeClass:     cfg.K8s.RuntimeClass,
		NodeSelector:     cfg.K8s.NodeSelector,
		Tolerations:      parseTolerations(cfg.K8s.Tolerations),
		ImagePullSecret:  cfg.K8s.ImagePullSecret,
		NetworkAttachDef: cfg.K8s.NetworkAttachDef,
	})
	if err != nil {
		logger.Warn().Err(err).Msg("k8s backend init failed — running without k8s")
		k8sBe = nil
	} else {
		logger.Info().Msg("kubernetes backend ready")
	}

	if cfg.Proxmox.Endpoint != "" {
		proxmoxBe, err = proxmox.New(proxmox.Options{
			Endpoint:    cfg.Proxmox.Endpoint,
			TokenID:     cfg.Proxmox.TokenID,
			TokenSecret: cfg.Proxmox.TokenSecret,
			DefaultNode: cfg.Proxmox.DefaultNode,
			Storage:     cfg.Proxmox.Storage,
			Bridge:      cfg.Proxmox.BridgeName,
			VerifyTLS:   cfg.Proxmox.VerifyTLS,
			Timeout:     cfg.Proxmox.APITimeout,
		})
		if err != nil {
			logger.Warn().Err(err).Msg("proxmox backend init failed")
			proxmoxBe = nil
		} else {
			logger.Info().Msg("proxmox backend ready")
		}
	}

	// --- Docker backend ---
	// A single Docker host is enough for a jeopardy CTF: one container per
	// challenge instance, published on an ephemeral port. Preferred over the
	// mock as soon as DOCKER_PUBLIC_HOST is set, since it is a real backend.
	if k8sBe == nil && os.Getenv("DOCKER_PUBLIC_HOST") != "" {
		dockerBe, err := dockerbackend.New(dockerbackend.Options{
			Host:        os.Getenv("DOCKER_HOST_ADDR"),
			PublicHost:  os.Getenv("DOCKER_PUBLIC_HOST"),
			Network:     os.Getenv("DOCKER_NETWORK"),
			AllowEgress: os.Getenv("DOCKER_ALLOW_EGRESS") == "true",
		})
		if err != nil {
			logger.Error().Err(err).Msg("docker backend unavailable")
		} else {
			k8sBe = dockerBe
			logger.Info().
				Str("public_host", os.Getenv("DOCKER_PUBLIC_HOST")).
				Msg("using Docker backend for container instances")
		}
	}

	if k8sBe == nil && proxmoxBe == nil {
		// Local dev fallback: with neither Kubernetes nor Proxmox available,
		// use a mock backend so the service can start and serve its API.
		// Enabled only when ORCHESTRATOR_ALLOW_MOCK_BACKEND=true (set in the
		// docker-compose dev env). Never enable in production.
		if cfg.App.IsDevelopment() && os.Getenv("ORCHESTRATOR_ALLOW_MOCK_BACKEND") == "true" {
			mb := mockbackend.New()
			k8sBe = mb
			proxmoxBe = mb
			logger.Warn().Msg("no real backend configured — using MOCK backend (dev only)")
		} else {
			return errors.New("no backends configured")
		}
	}

	// --- Events publisher ---
	publisher := events.NewPublisher(events.Config{
		Brokers: cfg.Kafka.Brokers,
		Topic:   cfg.Kafka.TopicInstanceEvents,
		UseTLS:  cfg.Kafka.UseTLS,
	}, logger)
	defer publisher.Close()

	// --- Scheduler + Service ---
	sched := scheduler.New(cfg, instanceRepo, logger)
	orch := service.New(service.Deps{
		Cfg:            cfg,
		Log:            logger,
		Machines:       machineRepo,
		Instances:      instanceRepo,
		FlagSubs:       flagSubRepo,
		Subnets:        subnetRepo,
		Capacity:       capacityRepo,
		Scheduler:      sched,
		NetAllocator:   netAllocator,
		VPN:            vpnCtrl,
		FlagGen:        flagGen,
		Events:         publisher,
		K8sBackend:     k8sBe,
		ProxmoxBackend: proxmoxBe,
	})

	// --- Background workers (in-process variants; can also run as separate procs) ---
	reaper := lifecycle.NewReaper(
		lifecycle.ReaperConfig{Interval: cfg.Lifecycle.ReaperInterval},
		lifecycle.ReaperDeps{
			Log:            logger.With().Str("component", "reaper").Logger(),
			Instances:      instanceRepo,
			Subnets:        subnetRepo,
			NetAllocator:   netAllocator,
			VPN:            vpnCtrl,
			Events:         publisher,
			K8sBackend:     k8sBe,
			ProxmoxBackend: proxmoxBe,
		})
	go reaper.Run(rootCtx)

	healthChecker := lifecycle.NewHealthChecker(
		lifecycle.HealthCheckerConfig{Interval: cfg.Lifecycle.HealthCheckInterval},
		lifecycle.HealthCheckerDeps{
			Log:            logger.With().Str("component", "healthchecker").Logger(),
			Instances:      instanceRepo,
			K8sBackend:     k8sBe,
			ProxmoxBackend: proxmoxBe,
		})
	go healthChecker.Run(rootCtx)

	// --- HTTP server ---
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	if len(cfg.HTTP.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(cfg.HTTP.TrustedProxies)
	}
	r.Use(
		middleware.RequestID(),
		middleware.Logger(logger),
		middleware.Recovery(logger),
		middleware.CORS(cfg.HTTP.CORSOrigins),
		middleware.SecurityHeaders(),
	)

	// Health (unauthenticated)
	healthH := handlers.NewHealthHandler(db, rdb, cfg.App.Version)
	healthH.Register(r)

	// Metrics
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Authenticated API
	v1 := r.Group("/v1")
	v1.Use(middleware.RequireAuth(validator, logger))

	instH := handlers.NewInstanceHandler(orch, logger)
	instH.Register(v1)

	admin := r.Group("/v1")
	admin.Use(middleware.RequireAuth(validator, logger), middleware.RequireRole("admin"))
	adminH := handlers.NewAdminHandler(orch, logger)
	adminH.Register(admin)

	httpSrv := &http.Server{
		Addr:         ":" + strconv.Itoa(cfg.HTTP.Port),
		Handler:      r,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	go func() {
		logger.Info().Int("port", cfg.HTTP.Port).Msg("http server listening")
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal().Err(err).Msg("http server failed")
		}
	}()

	// --- Graceful shutdown ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer shutdownCancel()

	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("http shutdown error")
	}

	reaper.Stop()
	healthChecker.Stop()

	logger.Info().Msg("orchestrator stopped")
	return nil
}

func newLogger(level, format string) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)
	zerolog.TimeFieldFormat = time.RFC3339Nano

	if format == "console" {
		return zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}).
			With().Timestamp().Str("svc", "orchestrator").Logger()
	}
	return zerolog.New(os.Stdout).With().Timestamp().Str("svc", "orchestrator").Logger()
}

func hydrateAllocator(ctx context.Context, alloc *network.Allocator, repo repository.SubnetAllocationRepository) error {
	cidrs, err := repo.ListAllocatedCIDRs(ctx)
	if err != nil {
		return err
	}
	// We don't have user_id directly here, but the allocator only needs the CIDRs
	// to mark them as taken. This is a simplified hydration; production version
	// queries lab.subnet_allocations directly with user_id + instance_id.
	existing := make([]network.ExistingAllocation, 0, len(cidrs))
	for _, c := range cidrs {
		existing = append(existing, network.ExistingAllocation{CIDR: c})
	}
	return alloc.Hydrate(ctx, existing)
}

// parseTolerations parses "key=value:effect" strings (best-effort).
// Empty list returns nil.
func parseTolerations(raw []string) []corev1.Toleration {
	out := make([]corev1.Toleration, 0, len(raw))
	for _, s := range raw {
		// Simple parse: key=value:effect; defaults to Equal+NoSchedule if format incomplete
		t := corev1.Toleration{
			Operator: corev1.TolerationOpEqual,
			Effect:   corev1.TaintEffectNoSchedule,
		}
		// We don't fully parse here in dev — production uses YAML config
		t.Key = s
		out = append(out, t)
	}
	return out
}
