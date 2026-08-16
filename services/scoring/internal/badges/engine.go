// Package badges implements the achievement/badge awarding engine.
//
// Triggers are stored in the DB as JSONB on each achievement row. After a
// scoring event, the engine evaluates each active achievement against the
// user's current state and awards any that newly match.
//
// Supported trigger types (matches DB CHECK constraint):
//
//   - count        — solved N of (content_type, optional filters)
//   - threshold    — total_points >= X, or other column >= X
//   - streak       — current_streak_days >= X
//   - first        — first user globally to achieve something
//   - specific     — solved specific content by ID
//   - manual       — never auto-awarded (admin only)
package badges

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/scoring/internal/repository"
)

type Engine struct {
	log              zerolog.Logger
	achievements     repository.AchievementRepository
	userAchievements repository.UserAchievementRepository
	owns             repository.OwnRepository
	userScores       repository.UserScoreRepository
	cache            map[string]*repository.Achievement
	cacheExpiry      time.Time
	cacheTTL         time.Duration
}

type Deps struct {
	Log              zerolog.Logger
	Achievements     repository.AchievementRepository
	UserAchievements repository.UserAchievementRepository
	Owns             repository.OwnRepository
	UserScores       repository.UserScoreRepository
}

func NewEngine(d Deps) *Engine {
	return &Engine{
		log:              d.Log,
		achievements:     d.Achievements,
		userAchievements: d.UserAchievements,
		owns:             d.Owns,
		userScores:       d.UserScores,
		cacheTTL:         5 * time.Minute,
	}
}

// Award is the result of a single award action.
type Award struct {
	UserID        uuid.UUID
	AchievementID uuid.UUID
	Code          string
	Name          string
	PointsAwarded int
	UnlockedAt    time.Time
}

// EvaluateOnSolve runs after a successful solve. It checks every active
// achievement against the user's current state and awards any new matches.
//
// Returns the list of newly-awarded achievements (so the caller can publish
// notifications, award bonus points, etc.).
func (e *Engine) EvaluateOnSolve(ctx context.Context, userID uuid.UUID, sc *repository.UserScore) ([]Award, error) {
	achievements, err := e.activeAchievements(ctx)
	if err != nil {
		return nil, err
	}

	var awarded []Award
	for _, a := range achievements {
		// Skip if already earned
		earned, err := e.userAchievements.HasEarned(ctx, userID, a.ID)
		if err != nil {
			e.log.Warn().Err(err).Str("achievement", a.Code).Msg("hasEarned check failed")
			continue
		}
		if earned {
			continue
		}

		ok, err := e.evaluateTrigger(ctx, userID, sc, a)
		if err != nil {
			e.log.Warn().Err(err).Str("achievement", a.Code).Msg("evaluate trigger failed")
			continue
		}
		if !ok {
			continue
		}

		err = e.userAchievements.Award(ctx, &repository.UserAchievement{
			UserID:        userID,
			AchievementID: a.ID,
			Progress:      100.0,
			UnlockedAt:    time.Now(),
			Displayed:     false,
		})
		if err != nil {
			if errors.Is(err, repository.ErrDuplicate) {
				continue
			}
			e.log.Error().Err(err).Str("achievement", a.Code).Msg("award failed")
			continue
		}

		awarded = append(awarded, Award{
			UserID:        userID,
			AchievementID: a.ID,
			Code:          a.Code,
			Name:          a.Name,
			PointsAwarded: a.PointsAwarded,
			UnlockedAt:    time.Now(),
		})

		e.log.Info().
			Str("user_id", userID.String()).
			Str("achievement", a.Code).
			Msg("achievement awarded")
	}

	return awarded, nil
}

// evaluateTrigger checks whether a single achievement's trigger condition is met.
func (e *Engine) evaluateTrigger(ctx context.Context, userID uuid.UUID, sc *repository.UserScore, a *repository.Achievement) (bool, error) {
	switch a.TriggerType {
	case "count":
		return e.evalCount(ctx, userID, a)
	case "threshold":
		return e.evalThreshold(sc, a), nil
	case "streak":
		return e.evalStreak(sc, a), nil
	case "first":
		// Handled separately — caller should pass the blood rank
		return false, nil
	case "specific":
		return e.evalSpecific(ctx, userID, a)
	case "manual":
		return false, nil
	default:
		return false, fmt.Errorf("unknown trigger type: %s", a.TriggerType)
	}
}

// evalCount: e.g. {content_type: "machine", n: 10} → solved 10 machines
func (e *Engine) evalCount(ctx context.Context, userID uuid.UUID, a *repository.Achievement) (bool, error) {
	contentType, _ := a.TriggerConfig["content_type"].(string)
	n, _ := a.TriggerConfig["n"].(float64) // JSON numbers decode to float64
	if contentType == "" || n <= 0 {
		return false, fmt.Errorf("count trigger missing content_type or n")
	}
	current, err := e.owns.CountByUserAndType(ctx, userID, contentType)
	if err != nil {
		return false, err
	}
	return current >= int(n), nil
}

// evalThreshold: e.g. {field: "total_points", threshold: 5000}
func (e *Engine) evalThreshold(sc *repository.UserScore, a *repository.Achievement) bool {
	if sc == nil {
		return false
	}
	field, _ := a.TriggerConfig["field"].(string)
	threshold, _ := a.TriggerConfig["threshold"].(float64)
	if field == "" || threshold <= 0 {
		return false
	}
	var value int64
	switch field {
	case "total_points":
		value = sc.TotalPoints
	case "machine_points":
		value = sc.MachinePoints
	case "challenge_points":
		value = sc.ChallengePoints
	case "first_bloods":
		value = int64(sc.FirstBloods)
	case "machines_owned":
		value = int64(sc.MachinesOwned)
	case "challenges_solved":
		value = int64(sc.ChallengesSolved)
	case "user_flags_count":
		value = int64(sc.UserFlagsCount)
	case "root_flags_count":
		value = int64(sc.RootFlagsCount)
	default:
		return false
	}
	return value >= int64(threshold)
}

// evalStreak: e.g. {days: 30}
func (e *Engine) evalStreak(sc *repository.UserScore, a *repository.Achievement) bool {
	if sc == nil {
		return false
	}
	days, _ := a.TriggerConfig["days"].(float64)
	if days <= 0 {
		return false
	}
	return sc.CurrentStreakDays >= int(days) || sc.LongestStreakDays >= int(days)
}

// evalSpecific: e.g. {content_type: "machine", content_id: "..."}
func (e *Engine) evalSpecific(ctx context.Context, userID uuid.UUID, a *repository.Achievement) (bool, error) {
	contentType, _ := a.TriggerConfig["content_type"].(string)
	contentIDStr, _ := a.TriggerConfig["content_id"].(string)
	flagType, _ := a.TriggerConfig["flag_type"].(string)
	if contentType == "" || contentIDStr == "" {
		return false, nil
	}
	contentID, err := uuid.Parse(contentIDStr)
	if err != nil {
		return false, err
	}
	return e.owns.HasOwned(ctx, userID, contentType, contentID, flagType)
}

// EvaluateFirstBlood awards "first to do X" achievements explicitly,
// based on a known blood event.
func (e *Engine) EvaluateFirstBlood(ctx context.Context, userID uuid.UUID, contentType string, bloodRank int) ([]Award, error) {
	if bloodRank != 1 {
		return nil, nil // only true first-blood
	}
	achievements, err := e.activeAchievements(ctx)
	if err != nil {
		return nil, err
	}

	var awarded []Award
	for _, a := range achievements {
		if a.TriggerType != "first" {
			continue
		}
		expectedType, _ := a.TriggerConfig["content_type"].(string)
		if expectedType != "" && expectedType != contentType {
			continue
		}
		earned, _ := e.userAchievements.HasEarned(ctx, userID, a.ID)
		if earned {
			continue
		}
		err := e.userAchievements.Award(ctx, &repository.UserAchievement{
			UserID: userID, AchievementID: a.ID,
			Progress: 100.0, UnlockedAt: time.Now(), Displayed: false,
		})
		if err == nil {
			awarded = append(awarded, Award{
				UserID: userID, AchievementID: a.ID, Code: a.Code, Name: a.Name,
				PointsAwarded: a.PointsAwarded, UnlockedAt: time.Now(),
			})
		}
	}
	return awarded, nil
}

// activeAchievements returns cached active achievements (refreshed every TTL).
func (e *Engine) activeAchievements(ctx context.Context) ([]*repository.Achievement, error) {
	if e.cache != nil && time.Now().Before(e.cacheExpiry) {
		out := make([]*repository.Achievement, 0, len(e.cache))
		for _, a := range e.cache {
			out = append(out, a)
		}
		return out, nil
	}
	list, err := e.achievements.ListActive(ctx)
	if err != nil {
		return nil, err
	}
	e.cache = make(map[string]*repository.Achievement, len(list))
	for _, a := range list {
		e.cache[a.Code] = a
	}
	e.cacheExpiry = time.Now().Add(e.cacheTTL)
	return list, nil
}

// InvalidateCache forces a re-read on the next call.
func (e *Engine) InvalidateCache() {
	e.cache = nil
	e.cacheExpiry = time.Time{}
}
