"""Tests for dynamic scoring formula."""

from __future__ import annotations

from app.services.scoring import (
    DEFAULT_DECAY_FACTOR,
    DEFAULT_DECAY_POWER,
    compute_dynamic_points,
    first_blood_bonus,
    recompute_participant_points,
)


def test_first_solver_gets_full_points():
    pts = compute_dynamic_points(
        base_points=500, solve_count=1, min_points=50
    )
    assert pts == 500


def test_more_solvers_decay_points():
    p1 = compute_dynamic_points(base_points=500, solve_count=1, min_points=50)
    p5 = compute_dynamic_points(base_points=500, solve_count=5, min_points=50)
    p25 = compute_dynamic_points(base_points=500, solve_count=25, min_points=50)
    assert p1 > p5 > p25
    assert p25 >= 50  # floor


def test_floor_kicks_in_for_many_solvers():
    pts = compute_dynamic_points(
        base_points=500, solve_count=1000, min_points=50
    )
    assert pts == 50


def test_base_lower_than_min_returns_base():
    # If base < min, return base (don't artificially inflate)
    pts = compute_dynamic_points(base_points=10, solve_count=5, min_points=50)
    assert pts == 10


def test_decay_curve_is_monotonic():
    """Points should never increase as solve_count grows."""
    prev = compute_dynamic_points(base_points=1000, solve_count=1, min_points=10)
    for n in range(2, 100):
        cur = compute_dynamic_points(
            base_points=1000, solve_count=n, min_points=10
        )
        assert cur <= prev
        prev = cur


def test_first_blood_bonus_first_place():
    bonus = first_blood_bonus(
        base_points=500, place=1, bonus_percentages=[0.05, 0.03, 0.01]
    )
    assert bonus == 25


def test_first_blood_bonus_no_bonus_for_4th():
    bonus = first_blood_bonus(
        base_points=500, place=4, bonus_percentages=[0.05, 0.03, 0.01]
    )
    assert bonus == 0


def test_recompute_subtracts_hints():
    solves = [{"points_at_solve": 100}, {"points_at_solve": 50}]
    total = recompute_participant_points(accepted_solves=solves, hint_deductions=20)
    assert total == 130


def test_recompute_floors_at_zero():
    solves = [{"points_at_solve": 10}]
    total = recompute_participant_points(accepted_solves=solves, hint_deductions=50)
    assert total == 0
