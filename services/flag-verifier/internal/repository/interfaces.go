package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// SubmissionRepository persists every flag submission attempt.
type SubmissionRepository interface {
	Insert(ctx context.Context, s *Submission) error
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Submission, error)
	CountWrongAttemptsRecent(ctx context.Context, userID uuid.UUID, contentID uuid.UUID, sinceSeconds int) (int, error)
	CountAcceptedForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error)
}

// OwnsLookup tells us if a user has already solved a flag (read-only — scoring owns the source of truth).
type OwnsLookup interface {
	HasOwned(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (bool, error)
	CountSolversForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error)
}

// InstanceLookup verifies the user actually owns the instance they claim
// to have solved. Prevents users submitting flags they got from leaks.
//
// For challenges (no instance), implementations may return a synthetic
// "always valid" record.
type InstanceLookup interface {
	GetInstance(ctx context.Context, instanceID uuid.UUID) (*InstanceSummary, error)
}

// MachineLookup gives us the metadata for verifying the flag against
// the right content type.
type MachineLookup interface {
	GetMachine(ctx context.Context, machineID uuid.UUID) (*MachineSummary, error)
}
