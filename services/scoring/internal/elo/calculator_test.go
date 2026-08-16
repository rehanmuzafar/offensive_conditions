package elo

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestCalculate_EqualPlayers_Win(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	a := PlayerState{Rating: 1500, MatchesPlayed: 20}
	b := PlayerState{Rating: 1500, MatchesPlayed: 20}

	out := calc.Calculate(a, b, Win)

	// Expected 0.5; K=32 (default); delta = 32 * (1 - 0.5) = 16
	assert.Equal(t, 1516, out.PlayerARatingAfter)
	assert.Equal(t, 1484, out.PlayerBRatingAfter)
	assert.Equal(t, 16, out.RatingDelta)
	assert.InDelta(t, 0.5, out.ExpectedA, 0.001)
}

func TestCalculate_EqualPlayers_Draw(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	a := PlayerState{Rating: 1500, MatchesPlayed: 20}
	b := PlayerState{Rating: 1500, MatchesPlayed: 20}

	out := calc.Calculate(a, b, Draw)
	assert.Equal(t, 1500, out.PlayerARatingAfter)
	assert.Equal(t, 1500, out.PlayerBRatingAfter)
}

func TestCalculate_UpsetWin(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	weak := PlayerState{Rating: 1200, MatchesPlayed: 50}
	strong := PlayerState{Rating: 1800, MatchesPlayed: 50}

	out := calc.Calculate(weak, strong, Win)

	// Weak beats strong → big gain for weak
	assert.Greater(t, out.PlayerARatingAfter, weak.Rating)
	assert.Less(t, out.PlayerBRatingAfter, strong.Rating)
	assert.Greater(t, out.RatingDelta, 25, "upset wins give substantial rating change")
}

func TestCalculate_ExpectedWin_SmallerDelta(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	strong := PlayerState{Rating: 1800, MatchesPlayed: 50}
	weak := PlayerState{Rating: 1200, MatchesPlayed: 50}

	out := calc.Calculate(strong, weak, Win)

	// Expected outcome → small delta
	assert.Less(t, out.RatingDelta, 10)
}

func TestKFactor_Provisional(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	a := PlayerState{Rating: 1500, MatchesPlayed: 3} // < 10
	b := PlayerState{Rating: 1500, MatchesPlayed: 50}

	out := calc.Calculate(a, b, Win)
	assert.Equal(t, 40, out.KFactor, "provisional players should use K=40")
}

func TestKFactor_HighRated(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	a := PlayerState{Rating: 2500, MatchesPlayed: 100} // above threshold
	b := PlayerState{Rating: 2500, MatchesPlayed: 100}

	out := calc.Calculate(a, b, Win)
	assert.Equal(t, 16, out.KFactor, "high rated should use K=16")
}

func TestKFactor_Default(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	a := PlayerState{Rating: 1500, MatchesPlayed: 50}
	b := PlayerState{Rating: 1500, MatchesPlayed: 50}

	out := calc.Calculate(a, b, Win)
	assert.Equal(t, 32, out.KFactor)
}

func TestIsInactive(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	now := time.Now()

	// Never played
	assert.False(t, calc.IsInactive(time.Time{}, now))

	// Recent (< 60 days)
	assert.False(t, calc.IsInactive(now.AddDate(0, 0, -30), now))

	// Old (> 60 days)
	assert.True(t, calc.IsInactive(now.AddDate(0, 0, -90), now))
}

func TestDecayAmount(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	// Rating well above initial → full decay
	assert.Equal(t, 25, calc.DecayAmount(2000))

	// Rating just barely above initial → partial
	assert.Equal(t, 10, calc.DecayAmount(1510))

	// Rating at initial → no decay
	assert.Equal(t, 0, calc.DecayAmount(1500))

	// Rating below initial (shouldn't happen but tested) → no decay
	assert.Equal(t, 0, calc.DecayAmount(1400))
}

func TestIsProvisional(t *testing.T) {
	calc := NewCalculator(DefaultConfig())
	assert.True(t, calc.IsProvisional(0))
	assert.True(t, calc.IsProvisional(9))
	assert.False(t, calc.IsProvisional(10))
	assert.False(t, calc.IsProvisional(100))
}

func TestExpectedScore_Bounded(t *testing.T) {
	calc := NewCalculator(DefaultConfig())

	// Massive rating difference shouldn't give 0 or 1 exactly
	out := calc.Calculate(
		PlayerState{Rating: 1000, MatchesPlayed: 50},
		PlayerState{Rating: 3000, MatchesPlayed: 50},
		Win,
	)
	assert.Greater(t, out.ExpectedA, 0.0)
	assert.Less(t, out.ExpectedA, 0.01) // very unlikely but not zero
}
