// Package idempotency caches recent submission results so identical replays
// don't re-execute the full verification pipeline.
//
// Key: hash(user_id, content_id, flag) → JSON of the original result
// TTL: configurable (default 60s)
//
// This is NOT for correctness — owns table already prevents double-awarding.
// It's purely a perf + UX optimisation: if a user fat-fingers the submit
// button twice, we return the same answer instead of doing redundant work.
package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

type Cache struct {
	rdb     *redis.Client
	log     zerolog.Logger
	ttl     time.Duration
	enabled bool
}

type Config struct {
	TTL     time.Duration
	Enabled bool
}

func New(rdb *redis.Client, cfg Config, log zerolog.Logger) *Cache {
	return &Cache{
		rdb:     rdb,
		log:     log,
		ttl:     cfg.TTL,
		enabled: cfg.Enabled,
	}
}

// CachedResult is the JSON payload we cache and return on a replay.
type CachedResult struct {
	SubmissionID    uuid.UUID `json:"submission_id"`
	Accepted        bool      `json:"accepted"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	FlagType        string    `json:"flag_type,omitempty"`
	IsFirstBlood    bool      `json:"is_first_blood"`
	BloodRank       int       `json:"blood_rank,omitempty"`
	Message         string    `json:"message,omitempty"`
	CachedAt        time.Time `json:"cached_at"`
}

// Get tries to find a cached result for the given submission inputs.
// Returns (nil, false, nil) if not cached.
func (c *Cache) Get(ctx context.Context, userID, contentID uuid.UUID, flag string) (*CachedResult, bool, error) {
	if !c.enabled {
		return nil, false, nil
	}
	key := buildKey(userID, contentID, flag)
	val, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("redis get: %w", err)
	}
	var r CachedResult
	if err := json.Unmarshal([]byte(val), &r); err != nil {
		return nil, false, fmt.Errorf("decode cached result: %w", err)
	}
	return &r, true, nil
}

// Put stores a result with TTL.
func (c *Cache) Put(ctx context.Context, userID, contentID uuid.UUID, flag string, r CachedResult) error {
	if !c.enabled {
		return nil
	}
	r.CachedAt = time.Now().UTC()
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	key := buildKey(userID, contentID, flag)
	return c.rdb.SetEx(ctx, key, string(body), c.ttl).Err()
}

// Invalidate removes a cached result.
// Used when admin manually re-runs a check.
func (c *Cache) Invalidate(ctx context.Context, userID, contentID uuid.UUID, flag string) error {
	if !c.enabled {
		return nil
	}
	return c.rdb.Del(ctx, buildKey(userID, contentID, flag)).Err()
}

// buildKey hashes the inputs so we don't store the raw flag in the key.
// Keeps Redis introspection safe (no flag values in `KEYS *`).
func buildKey(userID, contentID uuid.UUID, flag string) string {
	h := sha256.New()
	h.Write([]byte(userID.String()))
	h.Write([]byte{':'})
	h.Write([]byte(contentID.String()))
	h.Write([]byte{':'})
	h.Write([]byte(flag))
	return fmt.Sprintf("idem:fv:%s", hex.EncodeToString(h.Sum(nil))[:16])
}
