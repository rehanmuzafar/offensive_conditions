// Package ratelimit implements a sliding-window rate limiter backed by Redis.
//
// We use a Lua script for atomicity: ZREMRANGEBYSCORE (drop old) + ZCARD
// (count current) + ZADD (insert new) all in one round trip.
//
// Three independent buckets per submission:
//
//	user × content   — most aggressive (10/min, brute force per machine)
//	user × global    — catches whole-account spamming (100/min)
//	ip × global      — catches account farming (200/min)
//
// Any bucket exceeding limit → reject with retry_after.
package ratelimit

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

// slidingWindowScript implements the atomic check-and-add.
//
// KEYS[1] = bucket key (sorted set of submission timestamps)
// ARGV[1] = now (unix milliseconds)
// ARGV[2] = window (milliseconds)
// ARGV[3] = limit
// ARGV[4] = member (unique submission id)
//
// Returns: {allowed (0|1), current_count, retry_after_ms}
const slidingWindowScript = `
local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit     = tonumber(ARGV[3])
local member    = ARGV[4]
local cutoff    = now - window_ms

-- Drop entries outside the window
redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)

local count = redis.call("ZCARD", key)
if count >= limit then
  -- Compute retry_after = (oldest_in_window + window) - now
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local retry_after_ms = window_ms
  if oldest and #oldest >= 2 then
    retry_after_ms = (tonumber(oldest[2]) + window_ms) - now
    if retry_after_ms < 0 then retry_after_ms = 0 end
  end
  return {0, count, retry_after_ms}
end

redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window_ms * 2)
return {1, count + 1, 0}
`

type Limiter struct {
	rdb       *redis.Client
	script    *redis.Script
	log       zerolog.Logger

	perContentPerMin  int
	perUserPerMin     int
	perIPPerMin       int
	cooldownSeconds   int
	ipCooldownSeconds int
	windowSeconds     int
}

type Config struct {
	PerContentPerMin  int
	PerUserPerMin     int
	PerIPPerMin       int
	CooldownSeconds   int
	IPCooldownSeconds int
	WindowSeconds     int
}

func New(rdb *redis.Client, cfg Config, log zerolog.Logger) *Limiter {
	return &Limiter{
		rdb:               rdb,
		script:            redis.NewScript(slidingWindowScript),
		log:               log,
		perContentPerMin:  cfg.PerContentPerMin,
		perUserPerMin:     cfg.PerUserPerMin,
		perIPPerMin:       cfg.PerIPPerMin,
		cooldownSeconds:   cfg.CooldownSeconds,
		ipCooldownSeconds: cfg.IPCooldownSeconds,
		windowSeconds:     cfg.WindowSeconds,
	}
}

// Decision is the outcome of CheckAll.
type Decision struct {
	Allowed         bool
	Bucket          string // which bucket triggered the rejection
	RetryAfterSec   int
	UserContentCount int
	UserGlobalCount  int
	IPGlobalCount    int
}

// CheckAll evaluates all three buckets and returns the most restrictive result.
//
// If any bucket has a cooldown set (because of a previous violation), that
// also blocks.
func (l *Limiter) CheckAll(ctx context.Context, userID uuid.UUID, contentID uuid.UUID, ipAddr string) (Decision, error) {
	now := time.Now().UnixMilli()
	windowMs := int64(l.windowSeconds * 1000)
	member := fmt.Sprintf("%d-%s", now, uuid.NewString())

	// Check cooldown locks first
	if cd, err := l.cooldownRemaining(ctx, userCooldownKey(userID)); err == nil && cd > 0 {
		return Decision{Allowed: false, Bucket: "user_cooldown", RetryAfterSec: cd}, nil
	}
	if cd, err := l.cooldownRemaining(ctx, ipCooldownKey(ipAddr)); err == nil && cd > 0 {
		return Decision{Allowed: false, Bucket: "ip_cooldown", RetryAfterSec: cd}, nil
	}

	// User × Content
	allowed, count, retryMs, err := l.checkBucket(ctx, userContentKey(userID, contentID), now, windowMs, l.perContentPerMin, member)
	if err != nil {
		return Decision{}, err
	}
	d := Decision{Allowed: true, UserContentCount: count}
	if !allowed {
		_ = l.setCooldown(ctx, userCooldownKey(userID), l.cooldownSeconds)
		return Decision{
			Allowed: false, Bucket: "user_content",
			RetryAfterSec:    int((retryMs + 999) / 1000),
			UserContentCount: count,
		}, nil
	}

	// User × Global
	allowed, count, retryMs, err = l.checkBucket(ctx, userGlobalKey(userID), now, windowMs, l.perUserPerMin, member)
	if err != nil {
		return Decision{}, err
	}
	d.UserGlobalCount = count
	if !allowed {
		_ = l.setCooldown(ctx, userCooldownKey(userID), l.cooldownSeconds)
		return Decision{
			Allowed: false, Bucket: "user_global",
			RetryAfterSec:   int((retryMs + 999) / 1000),
			UserGlobalCount: count,
		}, nil
	}

	// IP × Global
	if ipAddr != "" {
		allowed, count, retryMs, err = l.checkBucket(ctx, ipGlobalKey(ipAddr), now, windowMs, l.perIPPerMin, member)
		if err != nil {
			return Decision{}, err
		}
		d.IPGlobalCount = count
		if !allowed {
			_ = l.setCooldown(ctx, ipCooldownKey(ipAddr), l.ipCooldownSeconds)
			return Decision{
				Allowed: false, Bucket: "ip_global",
				RetryAfterSec: int((retryMs + 999) / 1000),
				IPGlobalCount: count,
			}, nil
		}
	}

	return d, nil
}

func (l *Limiter) checkBucket(ctx context.Context, key string, now, windowMs int64, limit int, member string) (bool, int, int64, error) {
	if limit <= 0 {
		return true, 0, 0, nil
	}
	result, err := l.script.Run(ctx, l.rdb, []string{key},
		now, windowMs, limit, member).Result()
	if err != nil {
		return false, 0, 0, err
	}
	arr, ok := result.([]any)
	if !ok || len(arr) < 3 {
		return false, 0, 0, fmt.Errorf("unexpected script result: %v", result)
	}
	allowedRaw, _ := arr[0].(int64)
	countRaw, _ := arr[1].(int64)
	retryRaw, _ := arr[2].(int64)
	return allowedRaw == 1, int(countRaw), retryRaw, nil
}

func (l *Limiter) setCooldown(ctx context.Context, key string, seconds int) error {
	if seconds <= 0 {
		return nil
	}
	expiry := time.Now().Add(time.Duration(seconds) * time.Second).Unix()
	return l.rdb.SetEx(ctx, key, strconv.FormatInt(expiry, 10), time.Duration(seconds)*time.Second).Err()
}

func (l *Limiter) cooldownRemaining(ctx context.Context, key string) (int, error) {
	val, err := l.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return 0, nil
		}
		return 0, err
	}
	expiry, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, err
	}
	remaining := expiry - time.Now().Unix()
	if remaining < 0 {
		return 0, nil
	}
	return int(remaining), nil
}

// =============================================================================
// Key helpers
// =============================================================================

func userContentKey(u uuid.UUID, c uuid.UUID) string {
	return fmt.Sprintf("rl:fv:uc:%s:%s", u, c)
}

func userGlobalKey(u uuid.UUID) string {
	return fmt.Sprintf("rl:fv:u:%s", u)
}

func ipGlobalKey(ip string) string {
	return fmt.Sprintf("rl:fv:ip:%s", ip)
}

func userCooldownKey(u uuid.UUID) string {
	return fmt.Sprintf("rl:fv:cd:u:%s", u)
}

func ipCooldownKey(ip string) string {
	return fmt.Sprintf("rl:fv:cd:ip:%s", ip)
}
