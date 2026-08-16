package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// MachineRepository — read-only catalog access.
// Machines are managed by the content service; orchestrator only reads.
type MachineRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*Machine, error)
	GetBySlug(ctx context.Context, slug string) (*Machine, error)
}

// InstanceRepository — primary state store for lab instances.
type InstanceRepository interface {
	Create(ctx context.Context, in *LabInstance) error
	GetByID(ctx context.Context, id uuid.UUID) (*LabInstance, error)
	GetActiveByUser(ctx context.Context, userID uuid.UUID) ([]*LabInstance, error)
	GetByUserAndMachine(ctx context.Context, userID, machineID uuid.UUID) (*LabInstance, error)
	ListExpired(ctx context.Context, limit int) ([]*LabInstance, error)
	ListByState(ctx context.Context, state InstanceState, limit int) ([]*LabInstance, error)
	UpdateState(ctx context.Context, id uuid.UUID, newState InstanceState, allowedFrom ...InstanceState) error
	UpdateBackendRef(ctx context.Context, id uuid.UUID, backendRef, backendNode string) error
	UpdateIP(ctx context.Context, id uuid.UUID, ip, subnet string, vlanTag int) error
	UpdateExpiresAt(ctx context.Context, id uuid.UUID, expiresAt time.Time, incrementExtensions bool) error
	UpdateHealth(ctx context.Context, id uuid.UUID, status string) error
	UpdateFailure(ctx context.Context, id uuid.UUID, reason string) error
	MarkStarted(ctx context.Context, id uuid.UUID, ip, subnet string, startedAt time.Time) error
	MarkTerminated(ctx context.Context, id uuid.UUID, when time.Time) error
	CountActiveByUser(ctx context.Context, userID uuid.UUID) (int, error)
	SumActiveHoursThisMonth(ctx context.Context, userID uuid.UUID) (float64, error)
}

// FlagSubmissionRepository — append-only log of flag attempts.
type FlagSubmissionRepository interface {
	Record(ctx context.Context, sub *FlagSubmission) error
	HasSolved(ctx context.Context, userID, machineID uuid.UUID, flagType string) (bool, error)
}

// SubnetAllocationRepository — tracks /30 allocations to prevent reuse.
type SubnetAllocationRepository interface {
	Allocate(ctx context.Context, alloc *SubnetAllocation) error
	Release(ctx context.Context, instanceID uuid.UUID) error
	ListAllocatedCIDRs(ctx context.Context) ([]string, error)
	GetByInstance(ctx context.Context, instanceID uuid.UUID) (*SubnetAllocation, error)
}

// CapacityRepository — periodic snapshots of cluster capacity (for admin dashboard).
type CapacityRepository interface {
	Upsert(ctx context.Context, snap *CapacitySnapshot) error
	List(ctx context.Context) ([]*CapacitySnapshot, error)
}
