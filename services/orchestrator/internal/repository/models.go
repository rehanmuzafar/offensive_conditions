package repository

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// Machine — catalog item (Linux box, Windows VM, challenge container)
// =============================================================================

type MachineOSType string

const (
	OSTypeLinux   MachineOSType = "linux"
	OSTypeWindows MachineOSType = "windows"
	OSTypeOther   MachineOSType = "other"
)

type MachineBackend string

const (
	BackendKubernetes MachineBackend = "kubernetes"
	BackendProxmox    MachineBackend = "proxmox"
)

type MachineDifficulty string

const (
	DifficultyVeryEasy MachineDifficulty = "very_easy"
	DifficultyEasy     MachineDifficulty = "easy"
	DifficultyMedium   MachineDifficulty = "medium"
	DifficultyHard     MachineDifficulty = "hard"
	DifficultyInsane   MachineDifficulty = "insane"
)

type Machine struct {
	ID            uuid.UUID
	Slug          string
	Name          string
	OSType        MachineOSType
	Backend       MachineBackend
	Difficulty    MachineDifficulty
	TierRequired  string                  // free | pro | enterprise
	Image         string                  // container image or VM template ID
	CPURequest    string                  // e.g. "1"
	MemRequest    string                  // e.g. "2Gi"
	CPULimit      string
	MemLimit      string
	Ports         []int                   // exposed ports inside instance
	HasFlag       bool                    // some machines have user+root flags
	HasRootFlag   bool
	FlagSchema    string                  // "single" | "user_root"
	DefaultTTL    time.Duration
	Status        string                  // active | retired | draft
	Metadata      map[string]any
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// =============================================================================
// LabInstance — a running instance for a user
// =============================================================================

type InstanceState string

const (
	StatePending     InstanceState = "pending"
	StateSpawning    InstanceState = "spawning"
	StateRunning     InstanceState = "running"
	StateFailed      InstanceState = "failed"
	StateTerminating InstanceState = "terminating"
	StateTerminated  InstanceState = "terminated"
	StateExpired     InstanceState = "expired"
)

type LabInstance struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	MachineID       uuid.UUID
	MachineSlug     string                // denormalized for logs
	Backend         MachineBackend
	State           InstanceState
	BackendRef      string                // k8s pod name OR proxmox vmid
	BackendNode     string                // node placement
	IPAddress       *netip.Addr           // assigned instance IP
	Subnet          string                // assigned /30 (CIDR)
	VLANTag         int                   // optional
	FlagUserHash    string                // SHA-256(flag) — never raw
	FlagRootHash    string
	StartedAt       *time.Time
	ExpiresAt       time.Time
	TerminatedAt    *time.Time
	ExtensionsUsed  int
	LastHealthyAt   *time.Time
	HealthStatus    string                // ok | unhealthy | unknown
	FailureReason   string
	RequestID       string                // request that spawned it
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (i *LabInstance) IsActive() bool {
	switch i.State {
	case StatePending, StateSpawning, StateRunning:
		return true
	}
	return false
}

func (i *LabInstance) IsTerminal() bool {
	switch i.State {
	case StateTerminated, StateExpired, StateFailed:
		return true
	}
	return false
}

// =============================================================================
// FlagSubmission — record of a user submitting a flag
// =============================================================================

type FlagSubmission struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	InstanceID *uuid.UUID
	MachineID  uuid.UUID
	FlagType   string // "user" or "root"
	Submitted  string // raw input
	Correct    bool
	IPAddress  netip.Addr
	SubmittedAt time.Time
}

// =============================================================================
// SubnetAllocation — tracks /30 allocations
// =============================================================================

type SubnetAllocation struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	InstanceID *uuid.UUID
	CIDR       string
	State      string // allocated | released
	AllocatedAt time.Time
	ReleasedAt  *time.Time
}

// =============================================================================
// Capacity — point-in-time snapshot
// =============================================================================

type CapacitySnapshot struct {
	Backend          MachineBackend
	Node             string
	TotalCPUMillis   int64
	UsedCPUMillis    int64
	TotalMemMB       int64
	UsedMemMB        int64
	InstancesRunning int
	InstancesMax     int
	UpdatedAt        time.Time
}
