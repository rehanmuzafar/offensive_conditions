// Package mock provides a no-op lab backend for local development.
//
// It satisfies the backends.Backend interface without provisioning anything
// real — Spawn returns a fake reference and immediately reports the instance
// as running. This lets the orchestrator (and the rest of the platform) start
// and serve its API on a developer machine that has neither Kubernetes nor
// Proxmox available. It must NEVER be enabled in production.
package mock

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/offensive-conditions/orchestrator/internal/backends"
)

type Backend struct {
	mu    sync.Mutex
	state map[string]backends.Status
}

func New() *Backend {
	return &Backend{state: make(map[string]backends.Status)}
}

func (b *Backend) Name() string { return "mock" }

func (b *Backend) Spawn(_ context.Context, req backends.SpawnRequest) (*backends.SpawnResult, error) {
	ref := fmt.Sprintf("mock-%s-%d", req.MachineSlug, time.Now().UnixNano())
	ip := req.InstanceIP
	if ip == "" {
		ip = "10.10.10.10"
	}
	b.mu.Lock()
	b.state[ref] = backends.Status{
		Phase:     backends.PhaseRunning,
		Ready:     true,
		Reason:    "mock backend — no real instance provisioned",
		IPAddress: ip,
		NodeName:  "mock-node",
	}
	b.mu.Unlock()
	return &backends.SpawnResult{Ref: ref, NodeName: "mock-node"}, nil
}

func (b *Backend) Status(_ context.Context, ref string) (*backends.Status, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if s, ok := b.state[ref]; ok {
		return &s, nil
	}
	return &backends.Status{Phase: backends.PhaseGone, Ready: false, Reason: "unknown ref"}, nil
}

func (b *Backend) Teardown(_ context.Context, ref string) error {
	b.mu.Lock()
	delete(b.state, ref)
	b.mu.Unlock()
	return nil
}

func (b *Backend) Reset(_ context.Context, _ string) error { return nil }

func (b *Backend) Logs(_ context.Context, _ string, _ int) ([]string, error) {
	return []string{"[mock backend] no logs available"}, nil
}
