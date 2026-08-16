// Command healthcheck is the gateway's aggregated health endpoint. It probes
// every downstream platform service and exposes a single /healthz that the
// IngressGateway routes to, giving operators one URL to check the whole mesh.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/offcon/gateway/healthcheck/internal/checker"
	"github.com/offcon/gateway/healthcheck/internal/config"
	"github.com/offcon/gateway/healthcheck/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg := config.Load()
	logger.Info("starting gateway healthcheck",
		"listen", cfg.ListenAddr,
		"targets", len(cfg.Targets),
		"cache_ttl", cfg.CacheTTL.String(),
	)

	chk := checker.New(cfg)
	srv := server.New(cfg, chk, logger)

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Handler(),
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Warm the cache once before accepting traffic.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), cfg.ProbeTimeout*2)
		defer cancel()
		_ = chk.Get(ctx)
	}()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("http listening", "addr", cfg.ListenAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		logger.Error("server error", "error", err)
		os.Exit(1)
	case sig := <-sigCh:
		logger.Info("shutdown signal received", "signal", sig.String())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("shutdown complete")
}
