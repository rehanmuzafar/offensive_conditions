package points

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestCompute_BasicMachineSolve(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	// Medium machine, user flag, no blood, fresh
	out := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagUser, BloodRank: 0,
		ContentReleasedAt: time.Now(), SolvedAt: time.Now(),
	})

	// base=30, user share=0.30, no blood, no decay = 30 * 0.3 * 1 * 1 = 9
	assert.Equal(t, 9, out.FinalPoints)
}

func TestCompute_RootFlagWorthMore(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()

	userOut := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagUser, BloodRank: 0,
		ContentReleasedAt: now, SolvedAt: now,
	})
	rootOut := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagRoot, BloodRank: 0,
		ContentReleasedAt: now, SolvedAt: now,
	})

	// base=40, user=0.3 → 12, root=0.7 → 28
	assert.Equal(t, 12, userOut.FinalPoints)
	assert.Equal(t, 28, rootOut.FinalPoints)
	assert.Greater(t, rootOut.FinalPoints, userOut.FinalPoints)
}

func TestCompute_FirstBloodGetsMultiplier(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()

	regular := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagRoot, BloodRank: 0,
		ContentReleasedAt: now, SolvedAt: now,
	})
	firstBlood := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagRoot, BloodRank: 1,
		ContentReleasedAt: now, SolvedAt: now,
	})
	secondBlood := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagRoot, BloodRank: 2,
		ContentReleasedAt: now, SolvedAt: now,
	})

	// 30 * 0.7 * 1 = 21
	assert.Equal(t, 21, regular.FinalPoints)
	// 30 * 0.7 * 1.5 = 31.5 → 32
	assert.Equal(t, 32, firstBlood.FinalPoints)
	// 30 * 0.7 * 1.25 = 26.25 → 26
	assert.Equal(t, 26, secondBlood.FinalPoints)
}

func TestCompute_TimeDecay(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()

	fresh := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagRoot,
		ContentReleasedAt: now,
		SolvedAt:          now,
	})

	halfYear := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagRoot,
		ContentReleasedAt: now.AddDate(0, 0, -182),
		SolvedAt:          now,
	})

	oneYear := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagRoot,
		ContentReleasedAt: now.AddDate(0, 0, -365),
		SolvedAt:          now,
	})

	twoYears := calc.Compute(Input{
		Difficulty: Hard, FlagType: FlagRoot,
		ContentReleasedAt: now.AddDate(0, 0, -730),
		SolvedAt:          now,
	})

	assert.Equal(t, 28, fresh.FinalPoints)
	assert.Less(t, halfYear.FinalPoints, fresh.FinalPoints)
	assert.Less(t, oneYear.FinalPoints, halfYear.FinalPoints)

	// Floor: should plateau at 50%
	assert.Equal(t, 14, oneYear.FinalPoints)     // 28 * 0.5
	assert.Equal(t, 14, twoYears.FinalPoints)    // still 50% (floor)
	assert.Equal(t, oneYear.FinalPoints, twoYears.FinalPoints)
}

func TestCompute_MinimumOnePoint(t *testing.T) {
	cfg := DefaultConfig()
	cfg.DecayFloor = 0.0
	cfg.UserShare = 0.01 // tiny share
	calc := NewCalculator(cfg)

	out := calc.Compute(Input{
		Difficulty: VeryEasy, FlagType: FlagUser,
		ContentReleasedAt: time.Now().AddDate(-10, 0, 0),
		SolvedAt:          time.Now(),
	})
	// Should not be zero
	assert.GreaterOrEqual(t, out.FinalPoints, 1)
}

func TestCompute_ChallengeFullShare(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()

	out := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagChallenge,
		ContentReleasedAt: now, SolvedAt: now,
	})
	// 30 * 1.0 = 30
	assert.Equal(t, 30, out.FinalPoints)
}

func TestCompute_AllDifficulties(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()
	input := Input{FlagType: FlagChallenge, ContentReleasedAt: now, SolvedAt: now}

	cases := map[Difficulty]int{
		VeryEasy: 10, Easy: 20, Medium: 30, Hard: 40, Insane: 50,
	}
	for d, expected := range cases {
		input.Difficulty = d
		out := calc.Compute(input)
		assert.Equal(t, expected, out.FinalPoints, "difficulty %s", d)
	}
}

func TestCompute_ComponentsExposed(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	out := calc.Compute(Input{
		Difficulty: Medium, FlagType: FlagRoot, BloodRank: 1,
		ContentReleasedAt: time.Now(), SolvedAt: time.Now(),
	})
	assert.Equal(t, 30.0, out.Components["base"])
	assert.Equal(t, 0.70, out.Components["flag_share"])
	assert.Equal(t, 1.50, out.Components["blood_mult"])
	assert.InDelta(t, 1.0, out.Components["time_decay"], 0.01)
}

func TestParseDifficulty(t *testing.T) {
	cases := map[string]Difficulty{
		"very_easy": VeryEasy,
		"easy":      Easy,
		"medium":    Medium,
		"hard":      Hard,
		"insane":    Insane,
		"unknown":   Easy,
		"":          Easy,
	}
	for s, expected := range cases {
		assert.Equal(t, expected, ParseDifficulty(s), s)
	}
}

func TestIsBlood(t *testing.T) {
	assert.True(t, IsBlood(1))
	assert.True(t, IsBlood(2))
	assert.True(t, IsBlood(3))
	assert.False(t, IsBlood(0))
	assert.False(t, IsBlood(4))
}
