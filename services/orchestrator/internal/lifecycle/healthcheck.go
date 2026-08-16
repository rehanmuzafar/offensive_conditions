package lifecycle

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/offensive-conditions/orchestrator/internal/backends"
	"github.com/offensive-conditions/orchestrator/internal/repository"
)

// HealthChecker polls running instances and updates their health status.
//
// Detects stuck/dead pods, crashed VMs, network partitions. Marks instances
// as 'unhealthy' so the UI can surface the issue and (optionally) reaper
// can be configured to terminate persistently unhealthy ones.
type HealthChecker struct {
	log            zerolog.Logger
	instances      repository.InstanceRepository
	k8sBackend     backends.Backend
	proxmoxBackend backends.Backend

	interval     time.Duration
	batchSize    int
	concurrency  int

	stopCh   chan struct{}
	stopped  chan struct{}
	stopOnce sync.Once
}

type HealthCheckerConfig struct {
	Interval    time.Duration
	BatchSize   int
	Concurrency int
}

type HealthCheckerDeps struct {
	Log            zerolog.Logger
	Instances      repository.InstanceRepository
	K8sBackend     backends.Backend
	ProxmoxBackend backends.Backend
}

func NewHealthChecker(cfg HealthCheckerConfig, d HealthCheckerDeps) *HealthChecker {
	if cfg.Interval == 0 {
		cfg.Interval = 30 * time.Second
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 100
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = 8
	}
	return &HealthChecker{
		log:            d.Log,
		instances:      d.Instances,
		k8sBackend:     d.K8sBackend,
		proxmoxBackend: d.ProxmoxBackend,
		interval:       cfg.Interval,
		batchSize:      cfg.BatchSize,
		concurrency:    cfg.Concurrency,
		stopCh:         make(chan struct{}),
		stopped:        make(chan struct{}),
	}
}

func (h *HealthChecker) Run(ctx context.Context) {
	defer close(h.stopped)

	h.log.Info().Dur("interval", h.interval).Msg("health checker started")

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-h.stopCh:
			return
		case <-ticker.C:
			h.tick(ctx)
		}
	}
}

func (h *HealthChecker) Stop() {
	h.stopOnce.Do(func() { close(h.stopCh) })
	<-h.stopped
}

func (h *HealthChecker) tick(ctx context.Context) {
	running, err := h.instances.ListByState(ctx, repository.StateRunning, h.batchSize)
	if err != nil {
		h.log.Error().Err(err).Msg("health: list running failed")
		return
	}
	if len(running) == 0 {
		return
	}

	// Concurrent checks with a semaphore
	sem := make(chan struct{}, h.concurrency)
	var wg sync.WaitGroup
	for _, inst := range running {
		sem <- struct{}{}
		wg.Add(1)
		go func(in *repository.LabInstance) {
			defer wg.Done()
			defer func() { <-sem }()
			h.checkOne(ctx, in)
		}(inst)
	}
	wg.Wait()
}

func (h *HealthChecker) checkOne(ctx context.Context, inst *repository.LabInstance) {
	be := h.backendFor(inst.Backend)
	if be == nil || inst.BackendRef == "" {
		return
	}

	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	st, err := be.Status(checkCtx, inst.BackendRef)
	if err != nil {
		_ = h.instances.UpdateHealth(ctx, inst.ID, "unknown")
		return
	}

	switch st.Phase {
	case backends.PhaseRunning:
		if st.Ready {
			_ = h.instances.UpdateHealth(ctx, inst.ID, "ok")
		} else {
			_ = h.instances.UpdateHealth(ctx, inst.ID, "unhealthy")
		}
	case backends.PhaseFailed:
		h.log.Warn().
			Str("instance_id", inst.ID.String()).
			Str("reason", st.Reason).
			Msg("instance failed in backend; marking failed")
		_ = h.instances.UpdateFailure(ctx, inst.ID, st.Reason)
	case backends.PhaseGone:
		// Backend says the resource is gone but DB says running.
		// This indicates someone deleted the pod/VM out of band.
		h.log.Warn().Str("instance_id", inst.ID.String()).Msg("backend resource gone; marking terminated")
		_ = h.instances.MarkTerminated(ctx, inst.ID, time.Now())
	default:
		_ = h.instances.UpdateHealth(ctx, inst.ID, "unknown")
	}
}

func (h *HealthChecker) backendFor(b repository.MachineBackend) backends.Backend {
	switch b {
	case repository.BackendKubernetes:
		return h.k8sBackend
	case repository.BackendProxmox:
		return h.proxmoxBackend
	}
	return nil
}
