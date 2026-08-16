// Package lifecycle contains background workers that manage instance lifecycle:
//   - Reaper: terminates instances past their TTL
//   - HealthChecker: periodically polls backend status, updates health
package lifecycle

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/orchestrator/internal/backends"
	"github.com/offensive-conditions/orchestrator/internal/network"
	"github.com/offensive-conditions/orchestrator/internal/repository"
)

// Reaper scans for expired instances and terminates them.
//
// Runs in its own process (cmd/reaper) OR as a goroutine inside cmd/server
// — both modes are supported. The DB row lock ensures only one reaper
// processes a given instance at a time even if multiple are running.
type Reaper struct {
	log          zerolog.Logger
	instances    repository.InstanceRepository
	subnets      repository.SubnetAllocationRepository
	netAllocator *network.Allocator
	vpn          *network.VPNController
	events       EventPublisher
	k8sBackend   backends.Backend
	proxmoxBackend backends.Backend

	interval    time.Duration
	batchSize   int
	stopCh      chan struct{}
	stopped     chan struct{}
	stopOnce    sync.Once
}

// EventPublisher is the subset of events the reaper needs.
type EventPublisher interface {
	InstanceExpired(ctx context.Context, userID, instanceID, machineID uuid.UUID)
	InstanceTerminated(ctx context.Context, userID, instanceID, machineID uuid.UUID, reason string)
}

type ReaperConfig struct {
	Interval     time.Duration
	BatchSize    int
}

type ReaperDeps struct {
	Log            zerolog.Logger
	Instances      repository.InstanceRepository
	Subnets        repository.SubnetAllocationRepository
	NetAllocator   *network.Allocator
	VPN            *network.VPNController
	Events         EventPublisher
	K8sBackend     backends.Backend
	ProxmoxBackend backends.Backend
}

func NewReaper(cfg ReaperConfig, d ReaperDeps) *Reaper {
	if cfg.Interval == 0 {
		cfg.Interval = 60 * time.Second
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 25
	}
	return &Reaper{
		log:            d.Log,
		instances:      d.Instances,
		subnets:        d.Subnets,
		netAllocator:   d.NetAllocator,
		vpn:            d.VPN,
		events:         d.Events,
		k8sBackend:     d.K8sBackend,
		proxmoxBackend: d.ProxmoxBackend,
		interval:       cfg.Interval,
		batchSize:      cfg.BatchSize,
		stopCh:         make(chan struct{}),
		stopped:        make(chan struct{}),
	}
}

// Run blocks, ticking every interval, until Stop is called or ctx is cancelled.
func (r *Reaper) Run(ctx context.Context) {
	defer close(r.stopped)

	r.log.Info().Dur("interval", r.interval).Int("batch_size", r.batchSize).Msg("reaper started")

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	// Run once immediately
	r.tick(ctx)

	for {
		select {
		case <-ctx.Done():
			r.log.Info().Msg("reaper context cancelled")
			return
		case <-r.stopCh:
			r.log.Info().Msg("reaper stopped")
			return
		case <-ticker.C:
			r.tick(ctx)
		}
	}
}

func (r *Reaper) Stop() {
	r.stopOnce.Do(func() { close(r.stopCh) })
	<-r.stopped
}

// tick processes one batch of expired instances.
func (r *Reaper) tick(ctx context.Context) {
	expired, err := r.instances.ListExpired(ctx, r.batchSize)
	if err != nil {
		r.log.Error().Err(err).Msg("reaper: list expired failed")
		return
	}

	if len(expired) == 0 {
		return
	}

	r.log.Info().Int("count", len(expired)).Msg("reaper: processing expired instances")

	for _, inst := range expired {
		r.reap(ctx, inst)
	}
}

// reap tears down a single expired instance.
func (r *Reaper) reap(ctx context.Context, inst *repository.LabInstance) {
	log := r.log.With().
		Str("instance_id", inst.ID.String()).
		Str("user_id", inst.UserID.String()).
		Str("machine_slug", inst.MachineSlug).
		Logger()

	log.Info().Time("expired_at", inst.ExpiresAt).Msg("reaping expired instance")

	// Transition to terminating; if already terminal, skip
	if err := r.instances.UpdateState(ctx, inst.ID, repository.StateTerminating,
		repository.StatePending, repository.StateSpawning, repository.StateRunning); err != nil {
		log.Debug().Err(err).Msg("instance already terminal or being processed")
		return
	}

	// Backend teardown
	be := r.backendFor(inst.Backend)
	if be != nil && inst.BackendRef != "" {
		teardownCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		if err := be.Teardown(teardownCtx, inst.BackendRef); err != nil {
			log.Error().Err(err).Msg("backend teardown failed during reap")
			// Continue with cleanup anyway — orphaned resources will be GC'd later
		}
		cancel()
	}

	// VPN route cleanup
	if err := r.vpn.RemoveRoute(ctx, inst.ID.String()); err != nil {
		log.Warn().Err(err).Msg("vpn route remove failed")
	}

	// Network/subnet release
	_ = r.netAllocator.Release(inst.ID)
	_ = r.subnets.Release(ctx, inst.ID)

	// Mark expired (not terminated — distinguishes user-action vs TTL)
	now := time.Now()
	if err := r.instances.UpdateState(ctx, inst.ID, repository.StateExpired); err != nil {
		log.Error().Err(err).Msg("mark expired failed")
		return
	}
	if err := r.instances.MarkTerminated(ctx, inst.ID, now); err != nil {
		// MarkTerminated sets state=terminated; we want expired. Re-set.
		_ = r.instances.UpdateState(ctx, inst.ID, repository.StateExpired)
	}

	r.events.InstanceExpired(ctx, inst.UserID, inst.ID, inst.MachineID)
	log.Info().Msg("instance expired and cleaned up")
}

func (r *Reaper) backendFor(b repository.MachineBackend) backends.Backend {
	switch b {
	case repository.BackendKubernetes:
		return r.k8sBackend
	case repository.BackendProxmox:
		return r.proxmoxBackend
	}
	return nil
}
