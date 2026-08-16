// Package checker probes downstream services and caches the aggregate result.
package checker

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/offcon/gateway/healthcheck/internal/config"
)

// Status is the health of a single target.
type Status struct {
	Name      string `json:"name"`
	Healthy   bool   `json:"healthy"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
	HTTPCode  int    `json:"http_code,omitempty"`
}

// Report is the aggregated health snapshot.
type Report struct {
	Healthy   bool      `json:"healthy"`
	Checked   int       `json:"checked"`
	Up        int       `json:"up"`
	Down      int       `json:"down"`
	Targets   []Status  `json:"targets"`
	Timestamp time.Time `json:"timestamp"`
}

// Checker probes targets and caches results for CacheTTL.
type Checker struct {
	cfg    config.Config
	client *http.Client

	mu         sync.RWMutex
	cached     *Report
	cachedAt   time.Time
	probeGroup sync.Mutex // serialises refreshes so we don't stampede
}

// New constructs a Checker.
func New(cfg config.Config) *Checker {
	return &Checker{
		cfg: cfg,
		client: &http.Client{
			Timeout: cfg.ProbeTimeout,
			Transport: &http.Transport{
				MaxIdleConns:        32,
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     30 * time.Second,
				DisableKeepAlives:   false,
			},
		},
	}
}

// Get returns a cached report if fresh, else triggers a refresh.
func (c *Checker) Get(ctx context.Context) *Report {
	c.mu.RLock()
	if c.cached != nil && time.Since(c.cachedAt) < c.cfg.CacheTTL {
		r := c.cached
		c.mu.RUnlock()
		return r
	}
	c.mu.RUnlock()
	return c.refresh(ctx)
}

func (c *Checker) refresh(ctx context.Context) *Report {
	c.probeGroup.Lock()
	defer c.probeGroup.Unlock()

	// Double-check: another goroutine may have refreshed while we waited.
	c.mu.RLock()
	if c.cached != nil && time.Since(c.cachedAt) < c.cfg.CacheTTL {
		r := c.cached
		c.mu.RUnlock()
		return r
	}
	c.mu.RUnlock()

	statuses := c.probeAll(ctx)
	up := 0
	for _, s := range statuses {
		if s.Healthy {
			up++
		}
	}
	down := len(statuses) - up

	healthy := up > 0
	if c.cfg.RequireAllUp {
		healthy = down == 0
	}

	report := &Report{
		Healthy:   healthy,
		Checked:   len(statuses),
		Up:        up,
		Down:      down,
		Targets:   statuses,
		Timestamp: time.Now().UTC(),
	}

	c.mu.Lock()
	c.cached = report
	c.cachedAt = time.Now()
	c.mu.Unlock()
	return report
}

func (c *Checker) probeAll(ctx context.Context) []Status {
	sem := make(chan struct{}, c.cfg.ParallelProbes)
	results := make([]Status, len(c.cfg.Targets))
	var wg sync.WaitGroup

	for i, t := range c.cfg.Targets {
		wg.Add(1)
		go func(idx int, target config.Target) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[idx] = c.probeOne(ctx, target)
		}(i, t)
	}
	wg.Wait()
	return results
}

func (c *Checker) probeOne(ctx context.Context, t config.Target) Status {
	start := time.Now()
	reqCtx, cancel := context.WithTimeout(ctx, c.cfg.ProbeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, t.URL, nil)
	if err != nil {
		return Status{Name: t.Name, Healthy: false, Error: err.Error()}
	}
	req.Header.Set("User-Agent", "offcon-gateway-healthcheck/1.0")

	resp, err := c.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return Status{Name: t.Name, Healthy: false, LatencyMs: latency, Error: err.Error()}
	}
	defer resp.Body.Close()

	healthy := resp.StatusCode >= 200 && resp.StatusCode < 300
	return Status{
		Name:      t.Name,
		Healthy:   healthy,
		LatencyMs: latency,
		HTTPCode:  resp.StatusCode,
	}
}
