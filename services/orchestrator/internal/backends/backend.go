// Package backends defines the abstraction over different lab execution backends.
//
// Kubernetes runs Linux containers (HTB-style boxes, challenges, dojos).
// Proxmox runs full VMs (Windows machines, AD labs, kernel exploitation).
//
// The scheduler picks one based on machine.os_type + machine.backend.
package backends

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Backend executes the actual provisioning.
type Backend interface {
	// Name returns the backend identifier ("kubernetes" | "proxmox").
	Name() string

	// Spawn provisions a new instance. Returns a backend-specific reference
	// (pod name or VM ID) that's stored for later teardown.
	// IP/networking is wired separately by the network controller.
	Spawn(ctx context.Context, req SpawnRequest) (*SpawnResult, error)

	// Status returns the current state of the instance.
	Status(ctx context.Context, ref string) (*Status, error)

	// Teardown deletes the backend resource. Idempotent — succeeds even if
	// the resource is already gone.
	Teardown(ctx context.Context, ref string) error

	// Reset returns the instance to a clean state (re-pull image / restore snapshot).
	// May return ErrNotSupported on backends that don't support it.
	Reset(ctx context.Context, ref string) error

	// Logs returns recent stdout/stderr from the instance (last N lines).
	Logs(ctx context.Context, ref string, tailLines int) ([]string, error)
}

// SpawnRequest is what the scheduler asks a backend to do.
type SpawnRequest struct {
	InstanceID   uuid.UUID
	UserID       uuid.UUID
	MachineSlug  string                  // for naming/labels
	Image        string                  // container image OR VM template ID
	CPURequest   string                  // K8s resource string e.g. "1"
	MemRequest   string
	CPULimit     string
	MemLimit     string
	Ports        []int                   // ports to expose inside instance
	EnvVars      map[string]string       // includes FLAG_USER, FLAG_ROOT
	NetworkCIDR  string                  // /30 the instance should bind to
	GatewayIP    string                  // .1 of the /30
	InstanceIP   string                  // .2 of the /30
	TTL          time.Duration
	RuntimeClass string                  // "gvisor" for sandboxed
	NodeName     string                  // pin to specific node (optional)
}

// SpawnResult is returned after the backend creates the resource.
// The instance may still be initializing — caller must poll Status.
type SpawnResult struct {
	Ref      string // pod name or VMID
	NodeName string // which physical node it landed on
}

// Status represents the current backend-reported state.
type Status struct {
	Phase     Phase
	Ready     bool   // accepting traffic
	Reason    string // human-readable status (e.g. "ImagePullBackOff")
	IPAddress string // observed IP (may differ from requested during init)
	NodeName  string
}

type Phase string

const (
	PhasePending     Phase = "pending"
	PhaseInitializing Phase = "initializing"
	PhaseRunning     Phase = "running"
	PhaseFailed      Phase = "failed"
	PhaseTerminating Phase = "terminating"
	PhaseGone        Phase = "gone"
)

// ErrNotSupported indicates a backend doesn't implement an operation.
type ErrNotSupported struct{ Op string }

func (e ErrNotSupported) Error() string { return "operation not supported: " + e.Op }
