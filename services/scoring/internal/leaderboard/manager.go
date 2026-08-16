// Package leaderboard maintains Redis-backed sorted-set leaderboards.
//
// We use multiple boards keyed by namespace:
//   - global:all          → all-time global
//   - global:season:{id}  → current season
//   - country:{iso}       → per-country
//   - team:{team_id}      → per-team
//   - category:{cat}      → per-category (web|pwn|reverse|...)
//
// Postgres is the source of truth for points; Redis is a hot cache for
// O(log N) rank lookups and range queries.
package leaderboard

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

type Scope string

const (
	ScopeGlobalAll Scope = "global:all"
	ScopeSeason    Scope = "global:season"
	ScopeCountry   Scope = "country"
	ScopeTeam      Scope = "team"
	ScopeCategory  Scope = "category"
)

// Manager wraps Redis sorted-set operations behind a typed API.
type Manager struct {
	rdb    *redis.Client
	log    zerolog.Logger
	prefix string
}

func NewManager(rdb *redis.Client, log zerolog.Logger) *Manager {
	return &Manager{rdb: rdb, log: log, prefix: "lb"}
}

// Key returns the full Redis key for a scope variant.
func (m *Manager) Key(scope Scope, variant string) string {
	if variant == "" {
		return fmt.Sprintf("%s:%s", m.prefix, scope)
	}
	return fmt.Sprintf("%s:%s:%s", m.prefix, scope, strings.ToLower(variant))
}

// SetScore upserts a user's score in a leaderboard.
// Use IncrementScore for additive updates (cheaper).
func (m *Manager) SetScore(ctx context.Context, scope Scope, variant string, userID uuid.UUID, score int64) error {
	key := m.Key(scope, variant)
	return m.rdb.ZAdd(ctx, key, redis.Z{Score: float64(score), Member: userID.String()}).Err()
}

// IncrementScore atomically adds delta to a user's score in the given leaderboard.
// If the user doesn't exist on the board, they're added with the delta as score.
// Returns the new score.
func (m *Manager) IncrementScore(ctx context.Context, scope Scope, variant string, userID uuid.UUID, delta int64) (int64, error) {
	key := m.Key(scope, variant)
	newScore, err := m.rdb.ZIncrBy(ctx, key, float64(delta), userID.String()).Result()
	if err != nil {
		return 0, err
	}
	return int64(newScore), nil
}

// Remove removes a user from a board (e.g. on ban or account deletion).
func (m *Manager) Remove(ctx context.Context, scope Scope, variant string, userID uuid.UUID) error {
	key := m.Key(scope, variant)
	return m.rdb.ZRem(ctx, key, userID.String()).Err()
}

// =============================================================================
// Read paths
// =============================================================================

// Entry is one row in a leaderboard.
type Entry struct {
	Rank   int       `json:"rank"`
	UserID uuid.UUID `json:"user_id"`
	Score  int64     `json:"score"`
}

// Top returns the top N entries (descending). offset is 0-based.
func (m *Manager) Top(ctx context.Context, scope Scope, variant string, limit, offset int) ([]Entry, error) {
	key := m.Key(scope, variant)

	start := int64(offset)
	stop := int64(offset + limit - 1)

	results, err := m.rdb.ZRevRangeWithScores(ctx, key, start, stop).Result()
	if err != nil {
		return nil, err
	}

	out := make([]Entry, 0, len(results))
	for i, z := range results {
		member, ok := z.Member.(string)
		if !ok {
			continue
		}
		userID, err := uuid.Parse(member)
		if err != nil {
			continue
		}
		out = append(out, Entry{
			Rank:   offset + i + 1,
			UserID: userID,
			Score:  int64(z.Score),
		})
	}
	return out, nil
}

// RankOf returns the 1-based rank of a user (or 0 if not on the board).
func (m *Manager) RankOf(ctx context.Context, scope Scope, variant string, userID uuid.UUID) (int, error) {
	key := m.Key(scope, variant)
	rank, err := m.rdb.ZRevRank(ctx, key, userID.String()).Result()
	if err != nil {
		if err == redis.Nil {
			return 0, nil
		}
		return 0, err
	}
	return int(rank) + 1, nil
}

// ScoreOf returns the user's current score on this board.
// Returns (0, false) if not on the board.
func (m *Manager) ScoreOf(ctx context.Context, scope Scope, variant string, userID uuid.UUID) (int64, bool, error) {
	key := m.Key(scope, variant)
	score, err := m.rdb.ZScore(ctx, key, userID.String()).Result()
	if err != nil {
		if err == redis.Nil {
			return 0, false, nil
		}
		return 0, false, err
	}
	return int64(score), true, nil
}

// Size returns the number of entries on a board.
func (m *Manager) Size(ctx context.Context, scope Scope, variant string) (int64, error) {
	return m.rdb.ZCard(ctx, m.Key(scope, variant)).Result()
}

// Surrounding returns N entries above and N below a user.
// Useful for "your neighborhood on the leaderboard".
func (m *Manager) Surrounding(ctx context.Context, scope Scope, variant string, userID uuid.UUID, before, after int) ([]Entry, error) {
	rank, err := m.RankOf(ctx, scope, variant, userID)
	if err != nil {
		return nil, err
	}
	if rank == 0 {
		return nil, nil
	}
	offset := rank - 1 - before
	limit := before + 1 + after
	if offset < 0 {
		limit += offset
		offset = 0
	}
	if limit <= 0 {
		return nil, nil
	}
	return m.Top(ctx, scope, variant, limit, offset)
}

// =============================================================================
// Bulk operations
// =============================================================================

// Rebuild atomically replaces the contents of a board.
// Useful after season rollover or admin recomputation.
func (m *Manager) Rebuild(ctx context.Context, scope Scope, variant string, entries map[uuid.UUID]int64) error {
	key := m.Key(scope, variant)
	tmpKey := key + ":rebuild:" + strconv.FormatInt(time.Now().UnixNano(), 10)

	if len(entries) > 0 {
		members := make([]redis.Z, 0, len(entries))
		for u, s := range entries {
			members = append(members, redis.Z{Score: float64(s), Member: u.String()})
		}

		pipe := m.rdb.Pipeline()
		// Add to temp key in batches of 500
		const batchSize = 500
		for i := 0; i < len(members); i += batchSize {
			end := i + batchSize
			if end > len(members) {
				end = len(members)
			}
			pipe.ZAdd(ctx, tmpKey, members[i:end]...)
		}
		if _, err := pipe.Exec(ctx); err != nil {
			_ = m.rdb.Del(ctx, tmpKey).Err()
			return fmt.Errorf("populate temp key: %w", err)
		}
	}

	// Atomic swap via RENAME
	if err := m.rdb.Rename(ctx, tmpKey, key).Err(); err != nil {
		if len(entries) == 0 {
			// No temp key to rename; just delete the live key
			return m.rdb.Del(ctx, key).Err()
		}
		_ = m.rdb.Del(ctx, tmpKey).Err()
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// Clear empties a board.
func (m *Manager) Clear(ctx context.Context, scope Scope, variant string) error {
	return m.rdb.Del(ctx, m.Key(scope, variant)).Err()
}

// =============================================================================
// Convenience helpers
// =============================================================================

// PublishToAllRelevantBoards bumps a user's score on every board they belong to.
// Should be called after a successful flag submission.
func (m *Manager) PublishToAllRelevantBoards(ctx context.Context, ctx2 BoardContext, points int64) error {
	type bump struct {
		scope   Scope
		variant string
	}
	bumps := []bump{
		{ScopeGlobalAll, ""},
	}
	if ctx2.SeasonID != uuid.Nil {
		bumps = append(bumps, bump{ScopeSeason, ctx2.SeasonID.String()})
	}
	if ctx2.CountryCode != "" {
		bumps = append(bumps, bump{ScopeCountry, ctx2.CountryCode})
	}
	if ctx2.TeamID != uuid.Nil {
		bumps = append(bumps, bump{ScopeTeam, ctx2.TeamID.String()})
	}
	if ctx2.Category != "" {
		bumps = append(bumps, bump{ScopeCategory, ctx2.Category})
	}

	pipe := m.rdb.Pipeline()
	for _, b := range bumps {
		pipe.ZIncrBy(ctx, m.Key(b.scope, b.variant), float64(points), ctx2.UserID.String())
	}
	_, err := pipe.Exec(ctx)
	return err
}

// BoardContext bundles the user + their leaderboard memberships.
type BoardContext struct {
	UserID      uuid.UUID
	SeasonID    uuid.UUID // optional
	CountryCode string    // optional ISO-2
	TeamID      uuid.UUID // optional
	Category    string    // optional content category
}
