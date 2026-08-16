package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limiter is a Redis-backed sliding window rate limiter.
// Uses Redis sorted sets for accuracy with O(log n) operations.
type Limiter struct {
	rdb *redis.Client
}

func NewLimiter(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// GetRedis exposes the underlying client for ad-hoc Redis use (e.g. challenge storage).
// Keep usage minimal — most state should be in PostgreSQL.
func (l *Limiter) GetRedis() *redis.Client {
	return l.rdb
}

// Result describes the outcome of a rate limit check.
type Result struct {
	Allowed    bool
	Remaining  int
	Limit      int
	RetryAfter time.Duration
}

// ErrLimitExceeded is returned when the request would exceed the limit.
var ErrLimitExceeded = errors.New("rate limit exceeded")

// Allow checks if a request from `key` is allowed within `window` for `limit` requests.
// Uses a sliding window via sorted set with timestamp scores.
// Returns Result with allowed=false if denied.
func (l *Limiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (Result, error) {
	now := time.Now()
	windowStart := now.Add(-window).UnixNano()
	nowNS := now.UnixNano()

	pipe := l.rdb.Pipeline()
	// Drop entries older than window
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", windowStart))
	// Count current entries
	countCmd := pipe.ZCard(ctx, key)
	// Set expiry so unused keys cleanup
	pipe.Expire(ctx, key, window*2)
	if _, err := pipe.Exec(ctx); err != nil {
		return Result{}, fmt.Errorf("rate limit pipeline: %w", err)
	}

	count := int(countCmd.Val())
	if count >= limit {
		// Find oldest entry to compute retry-after
		oldest, err := l.rdb.ZRangeWithScores(ctx, key, 0, 0).Result()
		var retryAfter time.Duration
		if err == nil && len(oldest) > 0 {
			oldestTS := int64(oldest[0].Score)
			retryAfter = time.Duration(oldestTS+window.Nanoseconds()-nowNS) * time.Nanosecond
			if retryAfter < 0 {
				retryAfter = window
			}
		} else {
			retryAfter = window
		}
		return Result{
			Allowed:    false,
			Remaining:  0,
			Limit:      limit,
			RetryAfter: retryAfter,
		}, nil
	}

	// Add current request
	if err := l.rdb.ZAdd(ctx, key, redis.Z{
		Score:  float64(nowNS),
		Member: fmt.Sprintf("%d-%d", nowNS, count),
	}).Err(); err != nil {
		return Result{}, fmt.Errorf("rate limit add: %w", err)
	}

	return Result{
		Allowed:   true,
		Remaining: limit - count - 1,
		Limit:     limit,
	}, nil
}
