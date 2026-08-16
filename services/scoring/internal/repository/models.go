package repository

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// Submission — every flag submission attempt (from scoring.submissions table)
// =============================================================================

type Submission struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	TeamID           *uuid.UUID
	ContentType      string // machine|challenge|dojo_level|ctf_challenge|prolab_flag
	ContentID        uuid.UUID
	InstanceID       *uuid.UUID
	FlagType         string // user|root|challenge|prolab
	SubmittedValue   string // hashed (SHA-256)
	Accepted         bool
	RejectionReason  string
	PointsAwarded    int
	IsFirstBlood     bool
	BloodRank        int
	IPAddress        netip.Addr
	UserAgent        string
	ResponseTimeMS   int
	SecondsSinceSpawn int
	SuspicionScore   float64
	FlaggedForReview bool
	SubmittedAt      time.Time
}

// =============================================================================
// Own — denormalized record that user solved content (scoring.owns)
// =============================================================================

type Own struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	ContentType      string
	ContentID        uuid.UUID
	FlagType         string
	Points           int
	IsFirstBlood     bool
	BloodRank        int
	SolveTimeSeconds int
	SubmissionID     *uuid.UUID
	OwnedAt          time.Time
}

// =============================================================================
// PointHistory — append-only log of point changes
// =============================================================================

type PointHistory struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	EventType     string // machine_own|challenge_solve|first_blood|streak|achievement|decay|admin
	Points        int    // can be negative
	ReferenceType string
	ReferenceID   *uuid.UUID
	Description   string
	Metadata      map[string]any
	OccurredAt    time.Time
}

// =============================================================================
// UserScore — denormalized aggregate (scoring.user_scores)
// =============================================================================

type UserScore struct {
	UserID            uuid.UUID
	TotalPoints       int64
	MachinePoints     int64
	ChallengePoints   int64
	DojoPoints        int64
	CTFPoints         int64
	ProLabPoints      int64
	BonusPoints       int64
	MachinesOwned     int
	UserFlagsCount    int
	RootFlagsCount    int
	ChallengesSolved  int
	FirstBloods       int
	Points30D         int64
	Points7D          int64
	GlobalRank        *int
	CountryRank       *int
	CountryCode       string
	RankTier          string
	CurrentStreakDays int
	LongestStreakDays int
	LastSolveDate     *time.Time
	UpdatedAt         time.Time
}

// =============================================================================
// Achievement / UserAchievement
// =============================================================================

type Achievement struct {
	ID             uuid.UUID
	Code           string
	Name           string
	Description    string
	Category       string // progression|mastery|community|special
	Rarity         string // common|uncommon|rare|epic|legendary|mythic
	IconURL        string
	PointsAwarded  int
	TriggerType    string
	TriggerConfig  map[string]any
	IsSecret       bool
	IsActive       bool
	SortOrder      int
	CreatedAt      time.Time
}

type UserAchievement struct {
	UserID        uuid.UUID
	AchievementID uuid.UUID
	Progress      float64
	UnlockedAt    time.Time
	Displayed     bool
}

// =============================================================================
// RankTier
// =============================================================================

type RankTier struct {
	Code        string
	Name        string
	ColorHex    string
	IconURL     string
	SortOrder   int
	MinPoints   int64
	Description string
}

// =============================================================================
// Season (from migration 0002)
// =============================================================================

type SeasonState string

const (
	SeasonUpcoming SeasonState = "upcoming"
	SeasonActive   SeasonState = "active"
	SeasonEnded    SeasonState = "ended"
	SeasonArchived SeasonState = "archived"
)

type Season struct {
	ID                 uuid.UUID
	Code               string
	Name               string
	StartsAt           time.Time
	EndsAt             time.Time
	State              SeasonState
	CarryoverFraction  float64
	Rewards            map[string]any
	RolledOverAt       *time.Time
	SnapshotID         *uuid.UUID
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (s *Season) IsActive(now time.Time) bool {
	return s.State == SeasonActive && now.After(s.StartsAt) && now.Before(s.EndsAt)
}

// =============================================================================
// SeasonUserScore
// =============================================================================

type SeasonUserScore struct {
	SeasonID         uuid.UUID
	UserID           uuid.UUID
	TotalPoints      int64
	MachinePoints    int64
	ChallengePoints  int64
	CTFPoints        int64
	BonusPoints      int64
	MachinesOwned    int
	ChallengesSolved int
	FirstBloods      int
	FinalRank        *int
	FinalPercentile  *float64
	UpdatedAt        time.Time
}

// =============================================================================
// SeasonSnapshot
// =============================================================================

type SeasonSnapshot struct {
	ID             uuid.UUID
	SeasonID       uuid.UUID
	UserID         uuid.UUID
	FinalRank      int
	FinalPoints    int64
	Percentile     float64
	RewardsGranted map[string]any
	CapturedAt     time.Time
}

// =============================================================================
// ELO
// =============================================================================

type ELORating struct {
	UserID         uuid.UUID
	Rating         int
	PeakRating     int
	MatchesPlayed  int
	Wins           int
	Losses         int
	Draws          int
	LastMatchAt    *time.Time
	LastDecayAt    *time.Time
	IsProvisional  bool
	UpdatedAt      time.Time
}

type ELOMatch struct {
	ID                   uuid.UUID
	MatchID              uuid.UUID
	PlayerAID            uuid.UUID
	PlayerBID            uuid.UUID
	PlayerARatingBefore  int
	PlayerBRatingBefore  int
	Result               float64 // 1 | 0.5 | 0
	PlayerARatingAfter   int
	PlayerBRatingAfter   int
	RatingDelta          int
	KFactor              int
	MatchDurationSeconds int
	CompletedAt          time.Time
}

// =============================================================================
// DailyActivity / Streak
// =============================================================================

type DailyActivity struct {
	UserID        uuid.UUID
	ActivityDate  time.Time
	PointsEarned  int64
	SolvesCount   int
	FirstSolveAt  *time.Time
	LastSolveAt   *time.Time
}

// =============================================================================
// Cheat Flag (scoring.cheat_flags)
// =============================================================================

type CheatFlagSeverity string

const (
	SeverityLow      CheatFlagSeverity = "low"
	SeverityMedium   CheatFlagSeverity = "medium"
	SeverityHigh     CheatFlagSeverity = "high"
	SeverityCritical CheatFlagSeverity = "critical"
)

type CheatFlag struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	FlagType       string // shared_flag|impossible_speed|bot_pattern|multi_account|writeup_leak
	Severity       CheatFlagSeverity
	Confidence     float64
	Evidence       map[string]any
	SubmissionIDs  []uuid.UUID
	Status         string // pending|reviewing|confirmed|dismissed|appealed
	ReviewerID     *uuid.UUID
	ReviewNotes    string
	ActionTaken    string
	DetectedAt     time.Time
	ReviewedAt     *time.Time
}
