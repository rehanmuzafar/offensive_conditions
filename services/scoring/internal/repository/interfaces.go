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
	ErrDuplicate = errors.New("duplicate")
)

// SubmissionRepository — append-only log of every flag submission.
type SubmissionRepository interface {
	Insert(ctx context.Context, s *Submission) error
	GetByID(ctx context.Context, id uuid.UUID) (*Submission, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Submission, error)
	CountBloodsForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error)
	GetFirstNBloodWinners(ctx context.Context, contentType string, contentID uuid.UUID, flagType string, n int) ([]uuid.UUID, error)
	FindOtherUsersWithSameFlag(ctx context.Context, contentType string, contentID uuid.UUID, flagHash string, excludeUserID uuid.UUID) ([]uuid.UUID, error)
}

// OwnRepository — denormalized "user solved X" records.
// Unique constraint prevents double-awarding for the same flag type.
type OwnRepository interface {
	Insert(ctx context.Context, o *Own) error // returns ErrDuplicate if already owned
	GetByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Own, error)
	GetByUserAndContent(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (*Own, error)
	HasOwned(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (bool, error)
	CountByUserAndType(ctx context.Context, userID uuid.UUID, contentType string) (int, error)
	CountFirstBloodsForUser(ctx context.Context, userID uuid.UUID) (int, error)
}

// PointHistoryRepository
type PointHistoryRepository interface {
	Insert(ctx context.Context, p *PointHistory) error
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*PointHistory, error)
	SumByUser(ctx context.Context, userID uuid.UUID) (int64, error)
	SumByUserInRange(ctx context.Context, userID uuid.UUID, from, to time.Time) (int64, error)
}

// UserScoreRepository — denormalized current scores per user.
type UserScoreRepository interface {
	Get(ctx context.Context, userID uuid.UUID) (*UserScore, error)
	Upsert(ctx context.Context, s *UserScore) error
	IncrementPoints(ctx context.Context, userID uuid.UUID, delta IncrementInput) error
	BumpStreak(ctx context.Context, userID uuid.UUID, today time.Time) error
	UpdateRankTier(ctx context.Context, userID uuid.UUID, tier string) error
	UpdateRanks(ctx context.Context, userID uuid.UUID, globalRank, countryRank *int) error
	ListTop(ctx context.Context, limit, offset int) ([]*UserScore, error)
	ListTopByCountry(ctx context.Context, countryCode string, limit, offset int) ([]*UserScore, error)
	GetRankOf(ctx context.Context, userID uuid.UUID) (int, error)
	ResetBrokenStreaks(ctx context.Context) (int64, error)
}

// IncrementInput tells UserScoreRepository.IncrementPoints what to add.
type IncrementInput struct {
	Total         int64
	MachinePoints int64
	ChallengePoints int64
	DojoPoints    int64
	CTFPoints     int64
	ProLabPoints  int64
	BonusPoints   int64
	MachinesOwned int
	UserFlags     int
	RootFlags     int
	ChallengesSolved int
	FirstBloods   int
}

// AchievementRepository
type AchievementRepository interface {
	List(ctx context.Context) ([]*Achievement, error)
	ListActive(ctx context.Context) ([]*Achievement, error)
	GetByCode(ctx context.Context, code string) (*Achievement, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Achievement, error)
}

// UserAchievementRepository
type UserAchievementRepository interface {
	Award(ctx context.Context, ua *UserAchievement) error // ErrDuplicate if already owned
	ListForUser(ctx context.Context, userID uuid.UUID) ([]*UserAchievement, error)
	HasEarned(ctx context.Context, userID uuid.UUID, achievementID uuid.UUID) (bool, error)
	MarkDisplayed(ctx context.Context, userID, achievementID uuid.UUID) error
	ListUnseen(ctx context.Context, userID uuid.UUID) ([]*UserAchievement, error)
}

// RankTierRepository — static lookup; rarely changes.
type RankTierRepository interface {
	List(ctx context.Context) ([]*RankTier, error)
	TierForPoints(ctx context.Context, points int64) (*RankTier, error)
}

// SeasonRepository
type SeasonRepository interface {
	Create(ctx context.Context, s *Season) error
	GetByID(ctx context.Context, id uuid.UUID) (*Season, error)
	GetByCode(ctx context.Context, code string) (*Season, error)
	GetActive(ctx context.Context) (*Season, error)
	// The season whose window contains this instant — see postgres_main.go.
	GetContaining(ctx context.Context, at time.Time) (*Season, error)
	List(ctx context.Context, limit, offset int) ([]*Season, error)
	UpdateState(ctx context.Context, id uuid.UUID, state SeasonState) error
	MarkRolledOver(ctx context.Context, id uuid.UUID, snapshotID uuid.UUID, when time.Time) error
}

// SeasonUserScoreRepository
type SeasonUserScoreRepository interface {
	Upsert(ctx context.Context, s *SeasonUserScore) error
	IncrementPoints(ctx context.Context, seasonID, userID uuid.UUID, delta IncrementInput) error
	Get(ctx context.Context, seasonID, userID uuid.UUID) (*SeasonUserScore, error)
	ListTop(ctx context.Context, seasonID uuid.UUID, limit, offset int) ([]*SeasonUserScore, error)
	GetRankOf(ctx context.Context, seasonID, userID uuid.UUID) (int, error)
	CountUsers(ctx context.Context, seasonID uuid.UUID) (int, error)
}

// SeasonSnapshotRepository
type SeasonSnapshotRepository interface {
	BatchInsert(ctx context.Context, snaps []*SeasonSnapshot) error
	ListBySeason(ctx context.Context, seasonID uuid.UUID, limit, offset int) ([]*SeasonSnapshot, error)
	GetByUser(ctx context.Context, seasonID, userID uuid.UUID) (*SeasonSnapshot, error)
}

// ELORepository
type ELORepository interface {
	Get(ctx context.Context, userID uuid.UUID) (*ELORating, error)
	Upsert(ctx context.Context, r *ELORating) error
	RecordMatch(ctx context.Context, m *ELOMatch) error
	GetMatchHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*ELOMatch, error)
	ListTop(ctx context.Context, limit, offset int) ([]*ELORating, error)
	ListInactive(ctx context.Context, before time.Time, limit int) ([]*ELORating, error)
}

// DailyActivityRepository — for streak tracking.
type DailyActivityRepository interface {
	Upsert(ctx context.Context, a *DailyActivity) error
	GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (*DailyActivity, error)
	ListRecent(ctx context.Context, userID uuid.UUID, days int) ([]*DailyActivity, error)
}

// CheatFlagRepository
type CheatFlagRepository interface {
	Insert(ctx context.Context, f *CheatFlag) error
	ListPending(ctx context.Context, limit, offset int) ([]*CheatFlag, error)
	GetByID(ctx context.Context, id uuid.UUID) (*CheatFlag, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string, reviewerID uuid.UUID, notes, action string) error
	ListByUser(ctx context.Context, userID uuid.UUID) ([]*CheatFlag, error)
}
