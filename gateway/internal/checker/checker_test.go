package checker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/offcon/gateway/healthcheck/internal/config"
)

func newTestConfig(targets []config.Target) config.Config {
	return config.Config{
		ProbeTimeout:   2 * time.Second,
		CacheTTL:       50 * time.Millisecond,
		Targets:        targets,
		ParallelProbes: 4,
	}
}

func TestProbeAllHealthy(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer up.Close()

	cfg := newTestConfig([]config.Target{
		{Name: "a", URL: up.URL},
		{Name: "b", URL: up.URL},
	})
	c := New(cfg)
	report := c.Get(context.Background())

	if !report.Healthy {
		t.Fatalf("expected healthy, got unhealthy: %+v", report)
	}
	if report.Up != 2 || report.Down != 0 {
		t.Fatalf("expected 2 up 0 down, got %d up %d down", report.Up, report.Down)
	}
}

func TestProbeMixedDefaultHealthy(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer up.Close()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer down.Close()

	cfg := newTestConfig([]config.Target{
		{Name: "up", URL: up.URL},
		{Name: "down", URL: down.URL},
	})
	// Default RequireAllUp=false → healthy if at least one is up
	c := New(cfg)
	report := c.Get(context.Background())

	if !report.Healthy {
		t.Fatalf("expected healthy (require_all_up=false), got unhealthy")
	}
	if report.Up != 1 || report.Down != 1 {
		t.Fatalf("expected 1 up 1 down, got %d up %d down", report.Up, report.Down)
	}
}

func TestProbeMixedRequireAllUp(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer up.Close()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()

	cfg := newTestConfig([]config.Target{
		{Name: "up", URL: up.URL},
		{Name: "down", URL: down.URL},
	})
	cfg.RequireAllUp = true
	c := New(cfg)
	report := c.Get(context.Background())

	if report.Healthy {
		t.Fatalf("expected unhealthy (require_all_up=true with one down)")
	}
}

func TestCacheReturnsSameReport(t *testing.T) {
	hits := 0
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer up.Close()

	cfg := newTestConfig([]config.Target{{Name: "a", URL: up.URL}})
	cfg.CacheTTL = 5 * time.Second
	c := New(cfg)

	_ = c.Get(context.Background())
	firstHits := hits
	_ = c.Get(context.Background()) // should be cached, no new probe

	if hits != firstHits {
		t.Fatalf("expected cached result, but probe ran again: %d != %d", hits, firstHits)
	}
}

func TestUnreachableTarget(t *testing.T) {
	cfg := newTestConfig([]config.Target{
		{Name: "dead", URL: "http://127.0.0.1:1/livez"},
	})
	cfg.ProbeTimeout = 500 * time.Millisecond
	c := New(cfg)
	report := c.Get(context.Background())

	if report.Healthy {
		t.Fatalf("expected unhealthy for unreachable target")
	}
	if report.Targets[0].Error == "" {
		t.Fatalf("expected an error message for unreachable target")
	}
}
