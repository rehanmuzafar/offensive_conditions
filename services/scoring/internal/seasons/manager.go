// Package seasons handles season lifecycle: starting, ending, snapshotting,
// rolling over points to the next season.
//
// Triggered by cmd/seasonjob (cron) or admin API.
package seasons

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/scoring/internal/config"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/repository"
)

type Manager struct {
	cfg          *config.Config
	log          zerolog.Logger
	seasons      repository.SeasonRepository
	seasonScores repository.SeasonUserScoreRepository
	snapshots    repository.SeasonSnapshotRepository
	leaderboards *leaderboard.Manager
}

type Deps struct {
	Cfg          *config.Config
	Log          zerolog.Logger
	Seasons      repository.SeasonRepository
	SeasonScores repository.SeasonUserScoreRepository
	Snapshots    repository.SeasonSnapshotRepository
	Leaderboards *leaderboard.Manager
}

func NewManager(d Deps) *Manager {
	return &Manager{
		cfg: d.Cfg, log: d.Log,
		seasons:      d.Seasons,
		seasonScores: d.SeasonScores,
		snapshots:    d.Snapshots,
		leaderboards: d.Leaderboards,
	}
}

// Rollover ends the current season:
//   1. Snapshot all standings (immutable)
//   2. Mark season as ended
//   3. Clear season leaderboard in Redis
//   4. Start the next season (auto-generated from config)
func (m *Manager) Rollover(ctx context.Context, seasonID uuid.UUID) (*RolloverResult, error) {
	log := m.log.With().Str("season_id", seasonID.String()).Logger()

	season, err := m.seasons.GetByID(ctx, seasonID)
	if err != nil {
		return nil, fmt.Errorf("get season: %w", err)
	}
	if season.RolledOverAt != nil {
		return nil, errors.New("season already rolled over")
	}

	log.Info().Str("code", season.Code).Msg("starting season rollover")

	// Snapshot top N (we cap at 10000 for production safety)
	const maxParticipants = 10000
	totalUsers, err := m.seasonScores.CountUsers(ctx, seasonID)
	if err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}

	if totalUsers > maxParticipants {
		log.Warn().Int("total", totalUsers).Int("capped", maxParticipants).
			Msg("season has more users than max snapshot size; truncating")
		totalUsers = maxParticipants
	}

	// Build snapshots in batches
	const batchSize = 500
	snapshotID := uuid.New()
	processed := 0
	for offset := 0; offset < totalUsers; offset += batchSize {
		scores, err := m.seasonScores.ListTop(ctx, seasonID, batchSize, offset)
		if err != nil {
			return nil, fmt.Errorf("list season scores: %w", err)
		}
		if len(scores) == 0 {
			break
		}

		snaps := make([]*repository.SeasonSnapshot, 0, len(scores))
		for i, sc := range scores {
			rank := offset + i + 1
			percentile := percentileForRank(rank, totalUsers)
			rewards := computeRewards(rank, totalUsers, season.Rewards)
			snaps = append(snaps, &repository.SeasonSnapshot{
				SeasonID:       seasonID,
				UserID:         sc.UserID,
				FinalRank:      rank,
				FinalPoints:    sc.TotalPoints,
				Percentile:     percentile,
				RewardsGranted: rewards,
				CapturedAt:     time.Now(),
			})
		}
		if err := m.snapshots.BatchInsert(ctx, snaps); err != nil {
			return nil, fmt.Errorf("batch insert snapshots: %w", err)
		}
		processed += len(scores)
	}

	// Mark season ended
	now := time.Now()
	if err := m.seasons.MarkRolledOver(ctx, seasonID, snapshotID, now); err != nil {
		return nil, fmt.Errorf("mark rolled over: %w", err)
	}

	// Clear season leaderboard
	if err := m.leaderboards.Clear(ctx, leaderboard.ScopeSeason, seasonID.String()); err != nil {
		log.Warn().Err(err).Msg("clear season leaderboard failed")
	}

	// Auto-create next season
	next, err := m.createNextSeason(ctx, season)
	if err != nil {
		log.Warn().Err(err).Msg("auto-create next season failed")
	}

	result := &RolloverResult{
		SeasonID:        seasonID,
		SnapshotID:      snapshotID,
		ParticipantsCount: processed,
		RolledOverAt:    now,
	}
	if next != nil {
		result.NextSeasonID = &next.ID
		result.NextSeasonCode = next.Code
	}

	log.Info().Int("participants", processed).Msg("season rollover complete")
	return result, nil
}

type RolloverResult struct {
	SeasonID          uuid.UUID
	SnapshotID        uuid.UUID
	ParticipantsCount int
	RolledOverAt      time.Time
	NextSeasonID      *uuid.UUID
	NextSeasonCode    string
}

// createNextSeason auto-generates the following quarterly season.
func (m *Manager) createNextSeason(ctx context.Context, prev *repository.Season) (*repository.Season, error) {
	duration := time.Duration(m.cfg.Season.DurationDays) * 24 * time.Hour
	starts := prev.EndsAt
	ends := starts.Add(duration)

	code := generateSeasonCode(starts)
	name := generateSeasonName(starts)

	next := &repository.Season{
		Code:              code,
		Name:              name,
		StartsAt:          starts,
		EndsAt:            ends,
		State:             repository.SeasonActive,
		CarryoverFraction: m.cfg.Season.CarryoverFraction,
		Rewards:           map[string]any{},
	}

	if err := m.seasons.Create(ctx, next); err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			// Already created
			existing, err2 := m.seasons.GetByCode(ctx, code)
			if err2 == nil {
				return existing, nil
			}
		}
		return nil, err
	}
	return next, nil
}

// CheckAndRolloverDue checks if the active season has ended and rolls it over.
// Called by the cron job every hour or so.
func (m *Manager) CheckAndRolloverDue(ctx context.Context) error {
	active, err := m.seasons.GetActive(ctx)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil
		}
		return err
	}
	if time.Now().Before(active.EndsAt.Add(m.cfg.Season.RolloverGracePeriod)) {
		return nil
	}
	_, err = m.Rollover(ctx, active.ID)
	return err
}

// =============================================================================
// Helpers
// =============================================================================

// percentileForRank computes 0..100 percentile from 1-based rank.
// Rank 1 of 100 → 99 percentile; rank 100 of 100 → 0 percentile.
func percentileForRank(rank, total int) float64 {
	if total <= 1 {
		return 100
	}
	pct := (1 - float64(rank-1)/float64(total)) * 100
	return math.Round(pct*100) / 100
}

// computeRewards picks the reward tier for a given rank.
//   - top 0.1% → "diamond"
//   - top 1%   → "platinum"
//   - top 5%   → "gold"
//   - top 25%  → "silver"
//   - bottom   → "participation"
func computeRewards(rank, total int, seasonRewards map[string]any) map[string]any {
	if total == 0 {
		return nil
	}
	pct := float64(rank) / float64(total)
	tier := "participation"
	switch {
	case pct <= 0.001:
		tier = "diamond"
	case pct <= 0.01:
		tier = "platinum"
	case pct <= 0.05:
		tier = "gold"
	case pct <= 0.25:
		tier = "silver"
	}

	out := map[string]any{"tier": tier}
	// Merge in per-tier rewards from season config
	if tierRewards, ok := seasonRewards[tier].(map[string]any); ok {
		for k, v := range tierRewards {
			out[k] = v
		}
	}
	return out
}

func generateSeasonCode(starts time.Time) string {
	quarter := (int(starts.Month())-1)/3 + 1
	return fmt.Sprintf("%d-Q%d", starts.Year(), quarter)
}

func generateSeasonName(starts time.Time) string {
	quarter := (int(starts.Month())-1)/3 + 1
	names := map[int]string{1: "Spring", 2: "Summer", 3: "Autumn", 4: "Winter"}
	return fmt.Sprintf("%s %d", names[quarter], starts.Year())
}
