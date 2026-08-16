// Package points implements the scoring algorithm for machine/challenge solves.
//
// Final formula:
//
//	points = base_points × flag_share × first_blood_mult × time_decay
//
// Where:
//
//	base_points     = lookup by difficulty
//	flag_share      = 30% for user flag, 70% for root flag, 100% for challenge
//	first_blood_mult = 1.5 / 1.25 / 1.10 / 1.0 (based on blood rank)
//	time_decay      = max(floor, 1 - days_since_release/decay_days * (1-floor))
//
// Time decay slowly reduces the value of older machines so the leaderboard
// rewards keeping up with new content.
package points

import (
	"math"
	"time"
)

// Difficulty identifies a machine/challenge difficulty.
type Difficulty string

const (
	VeryEasy Difficulty = "very_easy"
	Easy     Difficulty = "easy"
	Medium   Difficulty = "medium"
	Hard     Difficulty = "hard"
	Insane   Difficulty = "insane"
)

// FlagType identifies which flag was solved.
type FlagType string

const (
	FlagUser      FlagType = "user"
	FlagRoot      FlagType = "root"
	FlagChallenge FlagType = "challenge"  // single-flag content
	FlagProLab    FlagType = "prolab"
)

// Config captures the tunable parameters for the formula.
type Config struct {
	BaseByDifficulty map[Difficulty]int
	UserShare        float64
	RootShare        float64

	FirstBloodMult  float64
	SecondBloodMult float64
	ThirdBloodMult  float64

	DecayDays  int     // 365 fully decayed
	DecayFloor float64 // never below this
}

// DefaultConfig returns HTB-style defaults.
func DefaultConfig() Config {
	return Config{
		BaseByDifficulty: map[Difficulty]int{
			VeryEasy: 10, Easy: 20, Medium: 30, Hard: 40, Insane: 50,
		},
		UserShare:       0.30,
		RootShare:       0.70,
		FirstBloodMult:  1.50,
		SecondBloodMult: 1.25,
		ThirdBloodMult:  1.10,
		DecayDays:       365,
		DecayFloor:      0.50,
	}
}

// Calculator computes points for a solve.
type Calculator struct {
	cfg Config
}

func NewCalculator(cfg Config) *Calculator {
	if len(cfg.BaseByDifficulty) == 0 {
		cfg = DefaultConfig()
	}
	return &Calculator{cfg: cfg}
}

// Input captures all the data needed to compute a solve's points.
type Input struct {
	Difficulty   Difficulty
	FlagType     FlagType
	BloodRank    int // 1=first blood, 2=second, 3=third, 0=not blood
	ContentReleasedAt time.Time
	SolvedAt     time.Time
}

// Output is the result of a point calculation, with breakdown for transparency.
type Output struct {
	FinalPoints  int
	Base         int
	FlagShare    float64
	BloodMult    float64
	TimeDecay    float64
	Components   map[string]float64 // for debugging / audit log
}

// Compute calculates the points awarded for a solve.
func (c *Calculator) Compute(in Input) Output {
	base, ok := c.cfg.BaseByDifficulty[in.Difficulty]
	if !ok {
		base = c.cfg.BaseByDifficulty[Easy]
	}
	flagShare := c.flagShare(in.FlagType)
	bloodMult := c.bloodMultiplier(in.BloodRank)
	decay := c.timeDecay(in.ContentReleasedAt, in.SolvedAt)

	raw := float64(base) * flagShare * bloodMult * decay
	finalPoints := int(math.Round(raw))
	if finalPoints < 1 {
		finalPoints = 1 // never award zero for a correct solve
	}

	return Output{
		FinalPoints: finalPoints,
		Base:        base,
		FlagShare:   flagShare,
		BloodMult:   bloodMult,
		TimeDecay:   decay,
		Components: map[string]float64{
			"base":         float64(base),
			"flag_share":   flagShare,
			"blood_mult":   bloodMult,
			"time_decay":   decay,
			"raw_result":   raw,
			"final_points": float64(finalPoints),
		},
	}
}

func (c *Calculator) flagShare(ft FlagType) float64 {
	switch ft {
	case FlagUser:
		return c.cfg.UserShare
	case FlagRoot:
		return c.cfg.RootShare
	case FlagChallenge, FlagProLab:
		return 1.0
	default:
		return 1.0
	}
}

func (c *Calculator) bloodMultiplier(bloodRank int) float64 {
	switch bloodRank {
	case 1:
		return c.cfg.FirstBloodMult
	case 2:
		return c.cfg.SecondBloodMult
	case 3:
		return c.cfg.ThirdBloodMult
	default:
		return 1.0
	}
}

// timeDecay linearly decays from 1.0 → floor over DecayDays.
//
//	d=0    → 1.0
//	d=days/2 → midpoint between 1 and floor
//	d>=days → floor
func (c *Calculator) timeDecay(releasedAt, solvedAt time.Time) float64 {
	if releasedAt.IsZero() {
		return 1.0
	}
	if c.cfg.DecayDays <= 0 {
		return 1.0
	}
	days := solvedAt.Sub(releasedAt).Hours() / 24
	if days < 0 {
		return 1.0
	}
	span := 1.0 - c.cfg.DecayFloor
	decayed := 1.0 - (days/float64(c.cfg.DecayDays))*span
	if decayed < c.cfg.DecayFloor {
		return c.cfg.DecayFloor
	}
	if decayed > 1.0 {
		return 1.0
	}
	return decayed
}

// =============================================================================
// Helpers
// =============================================================================

// ParseDifficulty converts a string from the DB to a typed Difficulty.
func ParseDifficulty(s string) Difficulty {
	switch s {
	case "very_easy":
		return VeryEasy
	case "easy":
		return Easy
	case "medium":
		return Medium
	case "hard":
		return Hard
	case "insane":
		return Insane
	default:
		return Easy
	}
}

// IsBlood returns true if the rank qualifies for a blood multiplier.
func IsBlood(rank int) bool {
	return rank >= 1 && rank <= 3
}
