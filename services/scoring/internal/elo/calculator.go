// Package elo implements the Elo rating system for PvP CTF matches.
//
// Standard formula:
//
//	expected_A = 1 / (1 + 10^((R_B - R_A) / 400))
//	new_R_A    = R_A + K × (S_A - expected_A)
//
// Where S_A is the actual result (1 = win, 0.5 = draw, 0 = loss).
//
// K-factor selection:
//   - Provisional (first N matches): high K (volatile, fast to find true rating)
//   - Normal: standard K (e.g. 32)
//   - Master (rating >= threshold): low K (stable, slow to change)
package elo

import (
	"math"
	"time"
)

type Config struct {
	InitialRating       int
	KFactorDefault      int
	KFactorHigh         int
	KFactorProvisional  int
	HighRatingThreshold int
	ProvisionalMatches  int
	InactivityDays      int
	DecayPerCycle       int
}

func DefaultConfig() Config {
	return Config{
		InitialRating:       1500,
		KFactorDefault:      32,
		KFactorHigh:         16,
		KFactorProvisional:  40,
		HighRatingThreshold: 2400,
		ProvisionalMatches:  10,
		InactivityDays:      60,
		DecayPerCycle:       25,
	}
}

// Result represents the outcome from player A's perspective.
type Result float64

const (
	Win  Result = 1.0
	Draw Result = 0.5
	Loss Result = 0.0
)

// PlayerState describes a single player at the time of a match.
type PlayerState struct {
	Rating         int
	MatchesPlayed  int
	LastMatchAt    time.Time
}

// MatchOutcome is what Calculate returns for a single match.
type MatchOutcome struct {
	PlayerARatingBefore int
	PlayerBRatingBefore int
	PlayerARatingAfter  int
	PlayerBRatingAfter  int
	RatingDelta         int // |after - before| for player A
	KFactor             int
	ExpectedA           float64
	ExpectedB           float64
}

type Calculator struct {
	cfg Config
}

func NewCalculator(cfg Config) *Calculator {
	if cfg.InitialRating == 0 {
		cfg = DefaultConfig()
	}
	return &Calculator{cfg: cfg}
}

// Calculate applies an Elo match result and returns the new ratings.
func (c *Calculator) Calculate(playerA, playerB PlayerState, result Result) MatchOutcome {
	expectedA := c.expectedScore(playerA.Rating, playerB.Rating)
	expectedB := 1 - expectedA

	kA := c.kFactor(playerA)
	kB := c.kFactor(playerB)

	deltaA := float64(kA) * (float64(result) - expectedA)
	deltaB := float64(kB) * (float64(1-result) - expectedB)

	newA := playerA.Rating + int(math.Round(deltaA))
	newB := playerB.Rating + int(math.Round(deltaB))

	return MatchOutcome{
		PlayerARatingBefore: playerA.Rating,
		PlayerBRatingBefore: playerB.Rating,
		PlayerARatingAfter:  newA,
		PlayerBRatingAfter:  newB,
		RatingDelta:         int(math.Abs(math.Round(deltaA))),
		KFactor:             kA, // record A's k-factor for the match log
		ExpectedA:           expectedA,
		ExpectedB:           expectedB,
	}
}

// expectedScore returns the probability that player A wins.
func (c *Calculator) expectedScore(ratingA, ratingB int) float64 {
	return 1.0 / (1.0 + math.Pow(10, float64(ratingB-ratingA)/400.0))
}

// kFactor picks the right K based on player state.
func (c *Calculator) kFactor(p PlayerState) int {
	if p.MatchesPlayed < c.cfg.ProvisionalMatches {
		return c.cfg.KFactorProvisional
	}
	if p.Rating >= c.cfg.HighRatingThreshold {
		return c.cfg.KFactorHigh
	}
	return c.cfg.KFactorDefault
}

// InitialRating returns the rating to assign new players.
func (c *Calculator) InitialRating() int {
	return c.cfg.InitialRating
}

// IsInactive returns true if the player hasn't played within the inactivity window.
func (c *Calculator) IsInactive(lastMatchAt time.Time, now time.Time) bool {
	if lastMatchAt.IsZero() {
		return false // never played, not "inactive"
	}
	return now.Sub(lastMatchAt) > time.Duration(c.cfg.InactivityDays)*24*time.Hour
}

// DecayAmount returns the rating points to subtract for an inactive player.
// Floors the result at the initial rating — we never decay below starting point.
func (c *Calculator) DecayAmount(currentRating int) int {
	maxDecay := currentRating - c.cfg.InitialRating
	if maxDecay <= 0 {
		return 0
	}
	if c.cfg.DecayPerCycle > maxDecay {
		return maxDecay
	}
	return c.cfg.DecayPerCycle
}

// IsProvisional returns true if the player is still in the volatile-K window.
func (c *Calculator) IsProvisional(matchesPlayed int) bool {
	return matchesPlayed < c.cfg.ProvisionalMatches
}
