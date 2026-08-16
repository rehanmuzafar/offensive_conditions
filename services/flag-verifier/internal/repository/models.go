package repository

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
)

// Submission mirrors scoring.submissions (we only insert + lookup, not update).
type Submission struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	TeamID            *uuid.UUID
	ContentType       string
	ContentID         uuid.UUID
	InstanceID        *uuid.UUID
	FlagType          string
	SubmittedValue    string // SHA-256 hex
	Accepted          bool
	RejectionReason   string
	PointsAwarded     int
	IsFirstBlood      bool
	BloodRank         int
	IPAddress         netip.Addr
	UserAgent         string
	ResponseTimeMS    int
	SecondsSinceSpawn int
	SuspicionScore    float64
	FlaggedForReview  bool
	SubmittedAt       time.Time
}

// MachineSummary is what we need from the content service to validate a submission.
// Fetched via the orchestrator (which already owns lab.machines) or directly
// from content service. For v1, we fetch from lab.lab_instances + content joins.
type MachineSummary struct {
	MachineID    uuid.UUID
	Slug         string
	UserFlagType string // user|root|challenge
	HasRootFlag  bool
	ReleasedAt   time.Time
	Difficulty   string
}

// InstanceSummary describes a running instance (for verifying ownership).
type InstanceSummary struct {
	InstanceID uuid.UUID
	UserID     uuid.UUID
	MachineID  uuid.UUID
	State      string // running|paused|stopped
	SpawnedAt  time.Time
	ExpiresAt  time.Time
}

// OwnRecord tells us if a user already owned a flag (so we can dedupe + compute blood rank).
type OwnRecord struct {
	UserID    uuid.UUID
	ContentID uuid.UUID
	FlagType  string
	OwnedAt   time.Time
	BloodRank int
}
