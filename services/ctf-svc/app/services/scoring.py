"""Dynamic scoring computation.

We use the CTFd-style decay curve:

    decay(n) = (1 - (n - 1) * decay_factor) ^ decay_power

This produces a smooth, monotonically decreasing curve where:
- n = 1 (first solver): decay = 1.0     → full points
- n grows: points shrink, floored at `min_points`

Default factor = 0.012, power = 4. With base = 500, min = 50:
    n=1   → 500
    n=5   → 411
    n=10  → 295
    n=25  → 100
    n=50  → 50 (floored)
"""

from __future__ import annotations

import math
from typing import Final


# CTFd-compatible defaults; configurable per event via settings
DEFAULT_DECAY_FACTOR: Final[float] = 0.012
DEFAULT_DECAY_POWER: Final[int] = 4


def compute_dynamic_points(
    *,
    base_points: int,
    solve_count: int,
    min_points: int,
    decay_factor: float = DEFAULT_DECAY_FACTOR,
    decay_power: int = DEFAULT_DECAY_POWER,
) -> int:
    """Return current point value given current accepted-solver count.

    solve_count is the number of accepted solvers AFTER this submission.
    For the first solver, solve_count=1 → full points.
    """
    if base_points <= min_points:
        return base_points
    if solve_count <= 1:
        return base_points
    factor = max(0.0, 1.0 - (solve_count - 1) * decay_factor)
    decayed = base_points * math.pow(factor, decay_power)
    return max(min_points, int(math.ceil(decayed)))


def first_blood_bonus(*, base_points: int, place: int, bonus_percentages: list[float]) -> int:
    """Bonus points awarded to nth solver (place=1,2,3...)."""
    if place <= 0 or place > len(bonus_percentages):
        return 0
    pct = bonus_percentages[place - 1]
    return int(round(base_points * pct))


def recompute_participant_points(
    *,
    accepted_solves: list[dict],
    hint_deductions: int,
) -> int:
    """Sum points across accepted solves for one participant.

    Each solve row carries `points_at_solve` (snapshot when the flag was accepted).
    Hint deductions are subtracted globally.
    """
    total = sum(int(s.get("points_at_solve", 0)) for s in accepted_solves)
    return max(0, total - hint_deductions)
