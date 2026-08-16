// Standalone reaper process. Can be run instead of (or alongside) the
// in-process reaper in cmd/server. Useful for horizontally scaling cleanup
// independently from the API tier.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/offensive-conditions/orchestrator/internal/backends"
	k8sbackend "github.com/offensive-conditions/orchestrator/internal/backends/kubernetes"
	"github.com/offensive-conditions/orchestrator/internal/backends/proxmox"
	"github.com/offensive-conditions/orchestrator/internal/config"
	"github.com/offensive-conditions/orchestrator/internal/events"
	"github.com/offensive-conditions/orchestrator/internal/lifecycle"
	"github.com/offensive-conditions/orchestrator/internal/network"
	"github.com/offensive-conditions/orchestrator/internal/repository"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("reaper startup failed")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	zerolog.TimeFieldFormat = time.RFC3339Nano
	logger := zerolog.New(os.Stdout).With().Timestamp().Str("svc", "orchestrator-reaper").Logger()
	logger.Info().Str("env", cfg.App.Env).Msg("starting reaper")

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := repository.NewPool(rootCtx, repository.PoolConfig{
		DSN:      cfg.DB.DSN(),
		MaxConns: int32(cfg.DB.MaxConns),
		MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer db.Close()

	instanceRepo := repository.NewPGInstanceRepo(db)
	subnetRepo := repository.NewPGSubnetAllocationRepo(db)

	netAllocator, err := network.NewAllocator(cfg.Network.UserSubnetBase,
		cfg.Network.UserSubnetSize, cfg.Network.InstanceSubnetSize)
	if err != nil {
		return fmt.Errorf("allocator: %w", err)
	}
	vpnCtrl := network.NewVPNController(cfg.Network.WireGuardAPI, cfg.Network.WireGuardAPIKey)

	var (
		k8sBe     backends.Backend
		proxmoxBe backends.Backend
	)

	k8sBe, err = k8sbackend.New(k8sbackend.Options{
		InCluster:    cfg.K8s.InCluster,
		Kubeconfig:   cfg.K8s.Kubeconfig,
		Namespace:    cfg.K8s.LabNamespace,
		RuntimeClass: cfg.K8s.RuntimeClass,
	})
	if err != nil {
		logger.Warn().Err(err).Msg("k8s backend disabled")
		k8sBe = nil
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
			logger.Warn().Err(err).Msg("proxmox backend disabled")
			proxmoxBe = nil
		}
	}

	if k8sBe == nil && proxmoxBe == nil {
		return errors.New("no backends configured for reaper")
	}

	publisher := events.NewPublisher(events.Config{
		Brokers: cfg.Kafka.Brokers,
		Topic:   cfg.Kafka.TopicInstanceEvents,
		UseTLS:  cfg.Kafka.UseTLS,
	}, logger)
	defer publisher.Close()

	reaper := lifecycle.NewReaper(
		lifecycle.ReaperConfig{Interval: cfg.Lifecycle.ReaperInterval},
		lifecycle.ReaperDeps{
			Log:            logger,
			Instances:      instanceRepo,
			Subnets:        subnetRepo,
			NetAllocator:   netAllocator,
			VPN:            vpnCtrl,
			Events:         publisher,
			K8sBackend:     k8sBe,
			ProxmoxBackend: proxmoxBe,
		})

	go reaper.Run(rootCtx)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")

	reaper.Stop()
	cancel()
	logger.Info().Msg("reaper stopped")
	return nil
}
