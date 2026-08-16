// Package config loads the healthcheck aggregator configuration from the
// environment.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Target is one downstream service the aggregator probes.
type Target struct {
	Name string
	URL  string
}

// Config holds the aggregator's runtime configuration.
type Config struct {
	ListenAddr     string
	ProbeTimeout   time.Duration
	CacheTTL       time.Duration
	Targets        []Target
	RequireAllUp   bool
	ParallelProbes int
}

// Load reads configuration from the environment, applying sensible defaults.
func Load() Config {
	cfg := Config{
		ListenAddr:     getEnv("HC_LISTEN_ADDR", ":8080"),
		ProbeTimeout:   getDuration("HC_PROBE_TIMEOUT", 3*time.Second),
		CacheTTL:       getDuration("HC_CACHE_TTL", 5*time.Second),
		RequireAllUp:   getBool("HC_REQUIRE_ALL_UP", false),
		ParallelProbes: getInt("HC_PARALLEL_PROBES", 8),
	}

	// Default target set — the 12 platform services. Each exposes /livez.
	defaults := []Target{
		{Name: "auth", URL: "http://auth.offcon.svc.cluster.local:8001/livez"},
		{Name: "user-svc", URL: "http://user-svc.offcon.svc.cluster.local:8002/livez"},
		{Name: "content-svc", URL: "http://content-svc.offcon.svc.cluster.local:8003/livez"},
		{Name: "ctf-svc", URL: "http://ctf-svc.offcon.svc.cluster.local:8004/livez"},
		{Name: "flag-verifier", URL: "http://flag-verifier.offcon.svc.cluster.local:8005/livez"},
		{Name: "forum-svc", URL: "http://forum-svc.offcon.svc.cluster.local:8005/livez"},
		{Name: "writeup-svc", URL: "http://writeup-svc.offcon.svc.cluster.local:8006/livez"},
		{Name: "payment-svc", URL: "http://payment-svc.offcon.svc.cluster.local:8007/livez"},
		{Name: "notification-svc", URL: "http://notification-svc.offcon.svc.cluster.local:8008/livez"},
		{Name: "bounty-svc", URL: "http://bounty-svc.offcon.svc.cluster.local:8009/livez"},
		{Name: "orchestrator", URL: "http://orchestrator.offcon.svc.cluster.local:8000/livez"},
		{Name: "scoring", URL: "http://scoring.offcon.svc.cluster.local:8004/livez"},
	}

	// Allow override via HC_TARGETS="name1=url1,name2=url2"
	if raw := os.Getenv("HC_TARGETS"); raw != "" {
		var parsed []Target
		for _, pair := range strings.Split(raw, ",") {
			kv := strings.SplitN(strings.TrimSpace(pair), "=", 2)
			if len(kv) == 2 {
				parsed = append(parsed, Target{Name: kv[0], URL: kv[1]})
			}
		}
		if len(parsed) > 0 {
			cfg.Targets = parsed
			return cfg
		}
	}
	cfg.Targets = defaults
	return cfg
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func getBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func getInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}
