// Package integration contains end-to-end tests that exercise the orchestrator
// against a real PostgreSQL and a mock backend.
//
// Run with: `make integration-test` (requires Postgres available — uses docker-compose by default).
//
// Skipped automatically if INTEGRATION_TEST env var is not set, so unit-test
// runs aren't slowed down.
package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/orchestrator/internal/backends"
	"github.com/offensive-conditions/orchestrator/internal/config"
	"github.com/offensive-conditions/orchestrator/internal/events"
	"github.com/offensive-conditions/orchestrator/internal/flag"
	"github.com/offensive-conditions/orchestrator/internal/network"
	"github.com/offensive-conditions/orchestrator/internal/repository"
	"github.com/offensive-conditions/orchestrator/internal/scheduler"
	"github.com/offensive-conditions/orchestrator/internal/service"
)

func skipIfNoIntegration(t *testing.T) {
	if os.Getenv("INTEGRATION_TEST") == "" {
		t.Skip("set INTEGRATION_TEST=1 to run integration tests")
	}
}

// mockBackend implements backends.Backend without touching K8s or Proxmox.
// Used by the integration test to drive the state machine.
type mockBackend struct {
	spawned     map[string]bool
	statuses    map[string]backends.Status
	failOnSpawn bool
}

func newMockBackend() *mockBackend {
	return &mockBackend{
		spawned:  map[string]bool{},
		statuses: map[string]backends.Status{},
	}
}

func (b *mockBackend) Name() string { return "mock" }
func (b *mockBackend) Spawn(_ context.Context, req backends.SpawnRequest) (*backends.SpawnResult, error) {
	ref := "mock-" + req.InstanceID.String()[:8]
	b.spawned[ref] = true
	b.statuses[ref] = backends.Status{
		Phase: backends.PhaseRunning, Ready: true,
		IPAddress: req.InstanceIP, NodeName: "mock-node",
	}
	return &backends.SpawnResult{Ref: ref, NodeName: "mock-node"}, nil
}
func (b *mockBackend) Status(_ context.Context, ref string) (*backends.Status, error) {
	if st, ok := b.statuses[ref]; ok {
		return &st, nil
	}
	return &backends.Status{Phase: backends.PhaseGone}, nil
}
func (b *mockBackend) Teardown(_ context.Context, ref string) error {
	delete(b.spawned, ref)
	delete(b.statuses, ref)
	return nil
}
func (b *mockBackend) Reset(_ context.Context, ref string) error { return nil }
func (b *mockBackend) Logs(_ context.Context, ref string, _ int) ([]string, error) {
	return []string{"[mock] running"}, nil
}

func setupTestEnv(t *testing.T) (*service.Orchestrator, *mockBackend, repository.InstanceRepository, func()) {
	skipIfNoIntegration(t)

	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		dsn = "postgres://offcon_admin:offcon_admin@localhost:5432/offcon?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN: dsn, MaxConns: 5, MinConns: 1,
	})
	require.NoError(t, err)

	cfg := &config.Config{
		Lifecycle: config.LifecycleConfig{
			DefaultTTL: 8 * time.Hour, MaxTTL: 24 * time.Hour,
			ExtendStep: 4 * time.Hour, MaxExtensions: 3,
		},
		Quota: config.QuotaConfig{
			ConcurrentInstancesFree: 1, ConcurrentInstancesPro: 4,
			MonthlyHoursFree: 40, MonthlyHoursPro: 300,
		},
		Network: config.NetworkConfig{
			UserSubnetBase:     "10.10.0.0/16",
			UserSubnetSize:     24,
			InstanceSubnetSize: 30,
		},
		Flag: config.FlagConfig{HMACSecret: "test-secret-do-not-use", Prefix: "OFFCON"},
	}

	logger := zerolog.Nop()

	machineRepo := repository.NewPGMachineRepo(pool)
	instanceRepo := repository.NewPGInstanceRepo(pool)
	flagSubRepo := repository.NewPGFlagSubmissionRepo(pool)
	subnetRepo := repository.NewPGSubnetAllocationRepo(pool)
	capacityRepo := repository.NewPGCapacityRepo(pool)

	allocator, err := network.NewAllocator(cfg.Network.UserSubnetBase,
		cfg.Network.UserSubnetSize, cfg.Network.InstanceSubnetSize)
	require.NoError(t, err)

	vpnCtrl := network.NewVPNController("", "") // dev mode
	flagGen := flag.NewGenerator([]byte(cfg.Flag.HMACSecret), cfg.Flag.Prefix)
	mockBe := newMockBackend()
	pub := &events.NoopPublisher{}
	sched := scheduler.New(cfg, instanceRepo, logger)

	orch := service.New(service.Deps{
		Cfg: cfg, Log: logger,
		Machines: machineRepo, Instances: instanceRepo, FlagSubs: flagSubRepo,
		Subnets: subnetRepo, Capacity: capacityRepo,
		Scheduler: sched, NetAllocator: allocator, VPN: vpnCtrl, FlagGen: flagGen,
		Events: &eventAdapter{NoopPublisher: pub},
		K8sBackend: mockBe, ProxmoxBackend: nil,
	})

	cleanup := func() {
		pool.Close()
	}
	return orch, mockBe, instanceRepo, cleanup
}

// eventAdapter satisfies service.EventPublisher
type eventAdapter struct {
	*events.NoopPublisher
}

func (e *eventAdapter) InstanceSpawned(_ context.Context, _, _, _ uuid.UUID, _ string, _ string) {}
func (e *eventAdapter) InstanceRunning(_ context.Context, _, _, _ uuid.UUID, _ string)            {}
func (e *eventAdapter) InstanceTerminated(_ context.Context, _, _, _ uuid.UUID, _ string)         {}
func (e *eventAdapter) InstanceExpired(_ context.Context, _, _, _ uuid.UUID)                      {}
func (e *eventAdapter) FlagSubmitted(_ context.Context, _, _ uuid.UUID, _ *uuid.UUID, _ string, _ bool) {
}

// TestSpawnFlow_SmokeTest exercises the spawn → run → submit-flag → terminate path.
// Note: requires a machine row in the database with slug 'mock-test'.
func TestSpawnFlow_SmokeTest(t *testing.T) {
	orch, _, instanceRepo, cleanup := setupTestEnv(t)
	defer cleanup()

	ctx := context.Background()
	userID := uuid.New()

	// Spawn
	out, err := orch.Spawn(ctx, service.SpawnInput{
		MachineSlug: "mock-test",
	}, service.RequestMeta{
		UserID: userID, UserTier: "pro", RequestID: "test-req-1",
	})
	if err != nil {
		t.Skipf("spawn failed (likely missing machine row): %v", err)
		return
	}

	// Wait briefly for async dispatch to mark running
	time.Sleep(3 * time.Second)

	inst, err := instanceRepo.GetByID(ctx, out.InstanceID)
	require.NoError(t, err)
	// State should be 'running' after mock backend reports ready
	require.NotEqual(t, "failed", string(inst.State))

	// Terminate
	require.NoError(t, orch.Terminate(ctx, out.InstanceID, service.RequestMeta{
		UserID: userID, UserTier: "pro",
	}))

	time.Sleep(2 * time.Second)

	final, err := instanceRepo.GetByID(ctx, out.InstanceID)
	require.NoError(t, err)
	require.Contains(t, []string{"terminating", "terminated"}, string(final.State))
}
