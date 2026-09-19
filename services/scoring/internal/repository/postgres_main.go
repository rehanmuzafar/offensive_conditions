package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// User Score repo
// =============================================================================

type pgUserScoreRepo struct{ pool *pgxpool.Pool }

func NewPGUserScoreRepo(pool *pgxpool.Pool) UserScoreRepository {
	return &pgUserScoreRepo{pool: pool}
}

const colsUserScore = `user_id, total_points, machine_points, challenge_points, dojo_points,
	ctf_points, prolab_points, bonus_points, machines_owned, user_flags_count, root_flags_count,
	challenges_solved, first_bloods, points_30d, points_7d, global_rank, country_rank,
	COALESCE(country_code, ''), COALESCE(rank_tier, ''), current_streak_days, longest_streak_days,
	last_solve_date, updated_at`

func scanUserScore(row pgx.Row) (*UserScore, error) {
	s := &UserScore{}
	var (
		globalRank    *int
		countryRank   *int
		lastSolveDate *time.Time
	)
	err := row.Scan(
		&s.UserID, &s.TotalPoints, &s.MachinePoints, &s.ChallengePoints, &s.DojoPoints,
		&s.CTFPoints, &s.ProLabPoints, &s.BonusPoints, &s.MachinesOwned,
		&s.UserFlagsCount, &s.RootFlagsCount, &s.ChallengesSolved, &s.FirstBloods,
		&s.Points30D, &s.Points7D, &globalRank, &countryRank,
		&s.CountryCode, &s.RankTier, &s.CurrentStreakDays, &s.LongestStreakDays,
		&lastSolveDate, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.GlobalRank = globalRank
	s.CountryRank = countryRank
	s.LastSolveDate = lastSolveDate
	return s, nil
}

func (r *pgUserScoreRepo) Get(ctx context.Context, userID uuid.UUID) (*UserScore, error) {
	q := `SELECT ` + colsUserScore + ` FROM scoring.user_scores WHERE user_id = $1`
	return scanUserScore(r.pool.QueryRow(ctx, q, userID))
}

func (r *pgUserScoreRepo) Upsert(ctx context.Context, s *UserScore) error {
	const q = `
		INSERT INTO scoring.user_scores
			(user_id, total_points, machine_points, challenge_points, dojo_points,
			 ctf_points, prolab_points, bonus_points, machines_owned, user_flags_count,
			 root_flags_count, challenges_solved, first_bloods, country_code, rank_tier)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), NULLIF($15, ''))
		ON CONFLICT (user_id) DO UPDATE SET
			total_points = EXCLUDED.total_points,
			machine_points = EXCLUDED.machine_points,
			challenge_points = EXCLUDED.challenge_points,
			dojo_points = EXCLUDED.dojo_points,
			ctf_points = EXCLUDED.ctf_points,
			prolab_points = EXCLUDED.prolab_points,
			bonus_points = EXCLUDED.bonus_points,
			machines_owned = EXCLUDED.machines_owned,
			user_flags_count = EXCLUDED.user_flags_count,
			root_flags_count = EXCLUDED.root_flags_count,
			challenges_solved = EXCLUDED.challenges_solved,
			first_bloods = EXCLUDED.first_bloods,
			country_code = COALESCE(EXCLUDED.country_code, scoring.user_scores.country_code),
			rank_tier = COALESCE(EXCLUDED.rank_tier, scoring.user_scores.rank_tier),
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		s.UserID, s.TotalPoints, s.MachinePoints, s.ChallengePoints, s.DojoPoints,
		s.CTFPoints, s.ProLabPoints, s.BonusPoints, s.MachinesOwned, s.UserFlagsCount,
		s.RootFlagsCount, s.ChallengesSolved, s.FirstBloods, s.CountryCode, s.RankTier,
	)
	return err
}

// IncrementPoints atomically applies a delta to a user's score row.
// Creates the row if missing (upsert pattern).
func (r *pgUserScoreRepo) IncrementPoints(ctx context.Context, userID uuid.UUID, d IncrementInput) error {
	const q = `
		INSERT INTO scoring.user_scores
			(user_id, total_points, machine_points, challenge_points, dojo_points, ctf_points,
			 prolab_points, bonus_points, machines_owned, user_flags_count, root_flags_count,
			 challenges_solved, first_bloods)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (user_id) DO UPDATE SET
			total_points = scoring.user_scores.total_points + EXCLUDED.total_points,
			machine_points = scoring.user_scores.machine_points + EXCLUDED.machine_points,
			challenge_points = scoring.user_scores.challenge_points + EXCLUDED.challenge_points,
			dojo_points = scoring.user_scores.dojo_points + EXCLUDED.dojo_points,
			ctf_points = scoring.user_scores.ctf_points + EXCLUDED.ctf_points,
			prolab_points = scoring.user_scores.prolab_points + EXCLUDED.prolab_points,
			bonus_points = scoring.user_scores.bonus_points + EXCLUDED.bonus_points,
			machines_owned = scoring.user_scores.machines_owned + EXCLUDED.machines_owned,
			user_flags_count = scoring.user_scores.user_flags_count + EXCLUDED.user_flags_count,
			root_flags_count = scoring.user_scores.root_flags_count + EXCLUDED.root_flags_count,
			challenges_solved = scoring.user_scores.challenges_solved + EXCLUDED.challenges_solved,
			first_bloods = scoring.user_scores.first_bloods + EXCLUDED.first_bloods,
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		userID, d.Total, d.MachinePoints, d.ChallengePoints, d.DojoPoints, d.CTFPoints,
		d.ProLabPoints, d.BonusPoints, d.MachinesOwned, d.UserFlags, d.RootFlags,
		d.ChallengesSolved, d.FirstBloods,
	)
	return err
}

// BumpStreak updates the user's current_streak_days based on their last_solve_date.
//
//	- Same day as last solve → no change
//	- Day after last solve → streak += 1
//	- Gap > 1 day → streak reset to 1
//	- First-ever solve → streak = 1
func (r *pgUserScoreRepo) BumpStreak(ctx context.Context, userID uuid.UUID, today time.Time) error {
	const q = `
		UPDATE scoring.user_scores SET
			current_streak_days = CASE
				WHEN last_solve_date = $2::date THEN current_streak_days
				WHEN last_solve_date = ($2::date - INTERVAL '1 day')::date THEN current_streak_days + 1
				ELSE 1
			END,
			longest_streak_days = GREATEST(
				longest_streak_days,
				CASE
					WHEN last_solve_date = $2::date THEN current_streak_days
					WHEN last_solve_date = ($2::date - INTERVAL '1 day')::date THEN current_streak_days + 1
					ELSE 1
				END
			),
			last_solve_date = $2::date,
			updated_at = NOW()
		WHERE user_id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, today)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// User score row doesn't exist yet — create it
		_, err = r.pool.Exec(ctx,
			`INSERT INTO scoring.user_scores (user_id, current_streak_days, longest_streak_days, last_solve_date)
			 VALUES ($1, 1, 1, $2::date)
			 ON CONFLICT (user_id) DO NOTHING`,
			userID, today)
	}
	return err
}

func (r *pgUserScoreRepo) UpdateRankTier(ctx context.Context, userID uuid.UUID, tier string) error {
	const q = `UPDATE scoring.user_scores SET rank_tier = $2, updated_at = NOW() WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID, tier)
	return err
}

func (r *pgUserScoreRepo) UpdateRanks(ctx context.Context, userID uuid.UUID, globalRank, countryRank *int) error {
	const q = `UPDATE scoring.user_scores SET global_rank = $2, country_rank = $3, updated_at = NOW() WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID, globalRank, countryRank)
	return err
}

func (r *pgUserScoreRepo) ListTop(ctx context.Context, limit, offset int) ([]*UserScore, error) {
	q := `SELECT ` + colsUserScore + ` FROM scoring.user_scores ORDER BY total_points DESC LIMIT $1 OFFSET $2`
	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserScore
	for rows.Next() {
		s, err := scanUserScore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgUserScoreRepo) ListTopByCountry(ctx context.Context, countryCode string, limit, offset int) ([]*UserScore, error) {
	q := `SELECT ` + colsUserScore + ` FROM scoring.user_scores
		WHERE country_code = $1 ORDER BY total_points DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, countryCode, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserScore
	for rows.Next() {
		s, err := scanUserScore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetRankOf returns the user's 1-based rank globally.
func (r *pgUserScoreRepo) GetRankOf(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `
		WITH ranked AS (
			SELECT user_id, RANK() OVER (ORDER BY total_points DESC) AS rnk
			FROM scoring.user_scores
		)
		SELECT rnk FROM ranked WHERE user_id = $1`
	var rank int
	err := r.pool.QueryRow(ctx, q, userID).Scan(&rank)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return rank, err
}

// ResetBrokenStreaks sets current_streak_days to 0 for users whose last_solve_date
// is older than yesterday (UTC). Run as a daily maintenance job.
func (r *pgUserScoreRepo) ResetBrokenStreaks(ctx context.Context) (int64, error) {
	const q = `UPDATE scoring.user_scores
		SET current_streak_days = 0, updated_at = NOW()
		WHERE current_streak_days > 0
		  AND last_solve_date < (CURRENT_DATE - INTERVAL '1 day')::date`
	tag, err := r.pool.Exec(ctx, q)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// =============================================================================
// Achievement repo
// =============================================================================

type pgAchievementRepo struct{ pool *pgxpool.Pool }

func NewPGAchievementRepo(pool *pgxpool.Pool) AchievementRepository {
	return &pgAchievementRepo{pool: pool}
}

func (r *pgAchievementRepo) List(ctx context.Context) ([]*Achievement, error) {
	const q = `SELECT id, code, name, description, category, rarity, COALESCE(icon_url, ''),
		points_awarded, trigger_type, trigger_config, is_secret, is_active, sort_order, created_at
		FROM scoring.achievements ORDER BY sort_order, name`
	return r.queryList(ctx, q)
}

func (r *pgAchievementRepo) ListActive(ctx context.Context) ([]*Achievement, error) {
	const q = `SELECT id, code, name, description, category, rarity, COALESCE(icon_url, ''),
		points_awarded, trigger_type, trigger_config, is_secret, is_active, sort_order, created_at
		FROM scoring.achievements WHERE is_active = TRUE ORDER BY category, sort_order, name`
	return r.queryList(ctx, q)
}

func (r *pgAchievementRepo) GetByCode(ctx context.Context, code string) (*Achievement, error) {
	const q = `SELECT id, code, name, description, category, rarity, COALESCE(icon_url, ''),
		points_awarded, trigger_type, trigger_config, is_secret, is_active, sort_order, created_at
		FROM scoring.achievements WHERE code = $1`
	return scanAchievement(r.pool.QueryRow(ctx, q, code))
}

func (r *pgAchievementRepo) GetByID(ctx context.Context, id uuid.UUID) (*Achievement, error) {
	const q = `SELECT id, code, name, description, category, rarity, COALESCE(icon_url, ''),
		points_awarded, trigger_type, trigger_config, is_secret, is_active, sort_order, created_at
		FROM scoring.achievements WHERE id = $1`
	return scanAchievement(r.pool.QueryRow(ctx, q, id))
}

func (r *pgAchievementRepo) queryList(ctx context.Context, q string) ([]*Achievement, error) {
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Achievement
	for rows.Next() {
		a, err := scanAchievement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanAchievement(row pgx.Row) (*Achievement, error) {
	a := &Achievement{}
	var triggerRaw []byte
	err := row.Scan(
		&a.ID, &a.Code, &a.Name, &a.Description, &a.Category, &a.Rarity, &a.IconURL,
		&a.PointsAwarded, &a.TriggerType, &triggerRaw, &a.IsSecret, &a.IsActive,
		&a.SortOrder, &a.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if len(triggerRaw) > 0 {
		_ = json.Unmarshal(triggerRaw, &a.TriggerConfig)
	}
	return a, nil
}

// =============================================================================
// User achievement repo
// =============================================================================

type pgUserAchievementRepo struct{ pool *pgxpool.Pool }

func NewPGUserAchievementRepo(pool *pgxpool.Pool) UserAchievementRepository {
	return &pgUserAchievementRepo{pool: pool}
}

func (r *pgUserAchievementRepo) Award(ctx context.Context, ua *UserAchievement) error {
	const q = `INSERT INTO scoring.user_achievements
		(user_id, achievement_id, progress, unlocked_at, displayed)
		VALUES ($1, $2, $3, COALESCE($4, NOW()), $5)`
	_, err := r.pool.Exec(ctx, q,
		ua.UserID, ua.AchievementID, ua.Progress, ua.UnlockedAt, ua.Displayed,
	)
	if isUniqueViolation(err) {
		return ErrDuplicate
	}
	return err
}

func (r *pgUserAchievementRepo) ListForUser(ctx context.Context, userID uuid.UUID) ([]*UserAchievement, error) {
	const q = `SELECT user_id, achievement_id, progress, unlocked_at, displayed
		FROM scoring.user_achievements WHERE user_id = $1 ORDER BY unlocked_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserAchievement
	for rows.Next() {
		ua := &UserAchievement{}
		if err := rows.Scan(&ua.UserID, &ua.AchievementID, &ua.Progress, &ua.UnlockedAt, &ua.Displayed); err != nil {
			return nil, err
		}
		out = append(out, ua)
	}
	return out, rows.Err()
}

func (r *pgUserAchievementRepo) HasEarned(ctx context.Context, userID uuid.UUID, achievementID uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM scoring.user_achievements WHERE user_id = $1 AND achievement_id = $2)`
	var exists bool
	err := r.pool.QueryRow(ctx, q, userID, achievementID).Scan(&exists)
	return exists, err
}

func (r *pgUserAchievementRepo) MarkDisplayed(ctx context.Context, userID, achievementID uuid.UUID) error {
	const q = `UPDATE scoring.user_achievements SET displayed = TRUE
		WHERE user_id = $1 AND achievement_id = $2`
	_, err := r.pool.Exec(ctx, q, userID, achievementID)
	return err
}

func (r *pgUserAchievementRepo) ListUnseen(ctx context.Context, userID uuid.UUID) ([]*UserAchievement, error) {
	const q = `SELECT user_id, achievement_id, progress, unlocked_at, displayed
		FROM scoring.user_achievements WHERE user_id = $1 AND displayed = FALSE
		ORDER BY unlocked_at`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserAchievement
	for rows.Next() {
		ua := &UserAchievement{}
		if err := rows.Scan(&ua.UserID, &ua.AchievementID, &ua.Progress, &ua.UnlockedAt, &ua.Displayed); err != nil {
			return nil, err
		}
		out = append(out, ua)
	}
	return out, rows.Err()
}

// =============================================================================
// Rank Tier repo
// =============================================================================

type pgRankTierRepo struct{ pool *pgxpool.Pool }

func NewPGRankTierRepo(pool *pgxpool.Pool) RankTierRepository {
	return &pgRankTierRepo{pool: pool}
}

func (r *pgRankTierRepo) List(ctx context.Context) ([]*RankTier, error) {
	const q = `SELECT code, name, COALESCE(name_color_hex, ''), COALESCE(icon_url, ''),
		sort_order, min_points, COALESCE(description, '')
		FROM scoring.rank_tiers ORDER BY sort_order`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RankTier
	for rows.Next() {
		t := &RankTier{}
		if err := rows.Scan(&t.Code, &t.Name, &t.ColorHex, &t.IconURL, &t.SortOrder, &t.MinPoints, &t.Description); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *pgRankTierRepo) TierForPoints(ctx context.Context, points int64) (*RankTier, error) {
	const q = `SELECT code, name, COALESCE(name_color_hex, ''), COALESCE(icon_url, ''),
		sort_order, min_points, COALESCE(description, '')
		FROM scoring.rank_tiers WHERE min_points <= $1 ORDER BY min_points DESC LIMIT 1`
	t := &RankTier{}
	err := r.pool.QueryRow(ctx, q, points).Scan(
		&t.Code, &t.Name, &t.ColorHex, &t.IconURL, &t.SortOrder, &t.MinPoints, &t.Description,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// =============================================================================
// Season repo
// =============================================================================

type pgSeasonRepo struct{ pool *pgxpool.Pool }

func NewPGSeasonRepo(pool *pgxpool.Pool) SeasonRepository {
	return &pgSeasonRepo{pool: pool}
}

const colsSeason = `id, code, name, number, starts_at, ends_at, state, carryover_fraction,
	rewards, rolled_over_at, snapshot_id, created_at, updated_at`

func scanSeason(row pgx.Row) (*Season, error) {
	s := &Season{}
	var (
		rewardsRaw   []byte
		rolledOverAt *time.Time
		snapshotID   *uuid.UUID
	)
	err := row.Scan(
		&s.ID, &s.Code, &s.Name, &s.Number, &s.StartsAt, &s.EndsAt, &s.State, &s.CarryoverFraction,
		&rewardsRaw, &rolledOverAt, &snapshotID, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if len(rewardsRaw) > 0 {
		_ = json.Unmarshal(rewardsRaw, &s.Rewards)
	}
	s.RolledOverAt = rolledOverAt
	s.SnapshotID = snapshotID
	return s, nil
}

func (r *pgSeasonRepo) Create(ctx context.Context, s *Season) error {
	rewardsJSON, _ := json.Marshal(s.Rewards)
	if len(rewardsJSON) == 0 {
		rewardsJSON = []byte("{}")
	}
	// number falls back to "one past the highest" so a season created without
	// one still lands in sequence rather than failing the NOT NULL.
	const q = `INSERT INTO scoring.seasons (id, code, name, number, starts_at, ends_at, state, carryover_fraction, rewards)
		VALUES (COALESCE(NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), gen_random_uuid()),
		        $2, $3,
		        COALESCE(NULLIF($4, 0), (SELECT COALESCE(MAX(number), 0) + 1 FROM scoring.seasons)),
		        $5, $6, $7, $8, $9::jsonb)`
	_, err := r.pool.Exec(ctx, q,
		s.ID, s.Code, s.Name, s.Number, s.StartsAt, s.EndsAt, s.State, s.CarryoverFraction, rewardsJSON,
	)
	if isUniqueViolation(err) {
		return ErrDuplicate
	}
	return err
}

func (r *pgSeasonRepo) GetByID(ctx context.Context, id uuid.UUID) (*Season, error) {
	q := `SELECT ` + colsSeason + ` FROM scoring.seasons WHERE id = $1`
	return scanSeason(r.pool.QueryRow(ctx, q, id))
}

func (r *pgSeasonRepo) GetByCode(ctx context.Context, code string) (*Season, error) {
	q := `SELECT ` + colsSeason + ` FROM scoring.seasons WHERE code = $1`
	return scanSeason(r.pool.QueryRow(ctx, q, code))
}

func (r *pgSeasonRepo) GetActive(ctx context.Context) (*Season, error) {
	q := `SELECT ` + colsSeason + ` FROM scoring.seasons
		WHERE state = 'active' AND NOW() BETWEEN starts_at AND ends_at
		ORDER BY starts_at DESC LIMIT 1`
	return scanSeason(r.pool.QueryRow(ctx, q))
}

// GetContaining returns the season whose window contains the given instant.
//
// Separate from GetActive because "which season is running now" and "which
// season owns this result" are different questions: a CTF that ends after the
// season rolls over belongs to the season it ended in, whichever one happens to
// be live when its last flag is scored.
func (r *pgSeasonRepo) GetContaining(ctx context.Context, at time.Time) (*Season, error) {
	q := `SELECT ` + colsSeason + ` FROM scoring.seasons
	       WHERE starts_at <= $1 AND ends_at > $1
	       ORDER BY starts_at DESC LIMIT 1`
	return scanSeason(r.pool.QueryRow(ctx, q, at))
}

func (r *pgSeasonRepo) List(ctx context.Context, limit, offset int) ([]*Season, error) {
	q := `SELECT ` + colsSeason + ` FROM scoring.seasons ORDER BY starts_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Season
	for rows.Next() {
		s, err := scanSeason(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSeasonRepo) UpdateState(ctx context.Context, id uuid.UUID, state SeasonState) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE scoring.seasons SET state = $2, updated_at = NOW() WHERE id = $1`, id, state)
	return err
}

func (r *pgSeasonRepo) MarkRolledOver(ctx context.Context, id, snapshotID uuid.UUID, when time.Time) error {
	const q = `UPDATE scoring.seasons SET state = 'ended', rolled_over_at = $2,
		snapshot_id = $3, updated_at = NOW() WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, when, snapshotID)
	return err
}

// =============================================================================
// Season User Score repo
// =============================================================================

type pgSeasonUserScoreRepo struct{ pool *pgxpool.Pool }

func NewPGSeasonUserScoreRepo(pool *pgxpool.Pool) SeasonUserScoreRepository {
	return &pgSeasonUserScoreRepo{pool: pool}
}

func (r *pgSeasonUserScoreRepo) Upsert(ctx context.Context, s *SeasonUserScore) error {
	const q = `INSERT INTO scoring.season_user_scores
		(season_id, user_id, total_points, machine_points, challenge_points, ctf_points,
		 bonus_points, machines_owned, challenges_solved, first_bloods)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (season_id, user_id) DO UPDATE SET
			total_points = EXCLUDED.total_points,
			machine_points = EXCLUDED.machine_points,
			challenge_points = EXCLUDED.challenge_points,
			ctf_points = EXCLUDED.ctf_points,
			bonus_points = EXCLUDED.bonus_points,
			machines_owned = EXCLUDED.machines_owned,
			challenges_solved = EXCLUDED.challenges_solved,
			first_bloods = EXCLUDED.first_bloods,
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		s.SeasonID, s.UserID, s.TotalPoints, s.MachinePoints, s.ChallengePoints,
		s.CTFPoints, s.BonusPoints, s.MachinesOwned, s.ChallengesSolved, s.FirstBloods,
	)
	return err
}

func (r *pgSeasonUserScoreRepo) IncrementPoints(ctx context.Context, seasonID, userID uuid.UUID, d IncrementInput) error {
	const q = `INSERT INTO scoring.season_user_scores
		(season_id, user_id, total_points, machine_points, challenge_points, ctf_points,
		 bonus_points, machines_owned, challenges_solved, first_bloods)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (season_id, user_id) DO UPDATE SET
			total_points = scoring.season_user_scores.total_points + EXCLUDED.total_points,
			machine_points = scoring.season_user_scores.machine_points + EXCLUDED.machine_points,
			challenge_points = scoring.season_user_scores.challenge_points + EXCLUDED.challenge_points,
			ctf_points = scoring.season_user_scores.ctf_points + EXCLUDED.ctf_points,
			bonus_points = scoring.season_user_scores.bonus_points + EXCLUDED.bonus_points,
			machines_owned = scoring.season_user_scores.machines_owned + EXCLUDED.machines_owned,
			challenges_solved = scoring.season_user_scores.challenges_solved + EXCLUDED.challenges_solved,
			first_bloods = scoring.season_user_scores.first_bloods + EXCLUDED.first_bloods,
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		seasonID, userID, d.Total, d.MachinePoints, d.ChallengePoints, d.CTFPoints,
		d.BonusPoints, d.MachinesOwned, d.ChallengesSolved, d.FirstBloods,
	)
	return err
}

func (r *pgSeasonUserScoreRepo) Get(ctx context.Context, seasonID, userID uuid.UUID) (*SeasonUserScore, error) {
	const q = `SELECT season_id, user_id, total_points, machine_points, challenge_points,
		ctf_points, bonus_points, machines_owned, challenges_solved, first_bloods,
		final_rank, final_percentile, updated_at
		FROM scoring.season_user_scores WHERE season_id = $1 AND user_id = $2`
	s := &SeasonUserScore{}
	var finalRank *int
	var finalPct *float64
	err := r.pool.QueryRow(ctx, q, seasonID, userID).Scan(
		&s.SeasonID, &s.UserID, &s.TotalPoints, &s.MachinePoints, &s.ChallengePoints,
		&s.CTFPoints, &s.BonusPoints, &s.MachinesOwned, &s.ChallengesSolved, &s.FirstBloods,
		&finalRank, &finalPct, &s.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.FinalRank = finalRank
	s.FinalPercentile = finalPct
	return s, nil
}

func (r *pgSeasonUserScoreRepo) ListTop(ctx context.Context, seasonID uuid.UUID, limit, offset int) ([]*SeasonUserScore, error) {
	const q = `SELECT season_id, user_id, total_points, machine_points, challenge_points,
		ctf_points, bonus_points, machines_owned, challenges_solved, first_bloods,
		final_rank, final_percentile, updated_at
		FROM scoring.season_user_scores WHERE season_id = $1
		ORDER BY total_points DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, seasonID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*SeasonUserScore
	for rows.Next() {
		s := &SeasonUserScore{}
		var finalRank *int
		var finalPct *float64
		err := rows.Scan(&s.SeasonID, &s.UserID, &s.TotalPoints, &s.MachinePoints, &s.ChallengePoints,
			&s.CTFPoints, &s.BonusPoints, &s.MachinesOwned, &s.ChallengesSolved, &s.FirstBloods,
			&finalRank, &finalPct, &s.UpdatedAt)
		if err != nil {
			return nil, err
		}
		s.FinalRank = finalRank
		s.FinalPercentile = finalPct
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSeasonUserScoreRepo) GetRankOf(ctx context.Context, seasonID, userID uuid.UUID) (int, error) {
	const q = `
		WITH ranked AS (
			SELECT user_id, RANK() OVER (ORDER BY total_points DESC) AS rnk
			FROM scoring.season_user_scores WHERE season_id = $1
		)
		SELECT rnk FROM ranked WHERE user_id = $2`
	var rank int
	err := r.pool.QueryRow(ctx, q, seasonID, userID).Scan(&rank)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return rank, err
}

func (r *pgSeasonUserScoreRepo) CountUsers(ctx context.Context, seasonID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM scoring.season_user_scores WHERE season_id = $1`,
		seasonID).Scan(&n)
	return n, err
}

// =============================================================================
// Season Snapshot repo
// =============================================================================

type pgSeasonSnapshotRepo struct{ pool *pgxpool.Pool }

func NewPGSeasonSnapshotRepo(pool *pgxpool.Pool) SeasonSnapshotRepository {
	return &pgSeasonSnapshotRepo{pool: pool}
}

func (r *pgSeasonSnapshotRepo) BatchInsert(ctx context.Context, snaps []*SeasonSnapshot) error {
	if len(snaps) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	batch := &pgx.Batch{}
	for _, s := range snaps {
		rewardsJSON, _ := json.Marshal(s.RewardsGranted)
		if len(rewardsJSON) == 0 {
			rewardsJSON = []byte("{}")
		}
		batch.Queue(`INSERT INTO scoring.season_snapshots
			(season_id, user_id, final_rank, final_points, percentile, rewards_granted)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb)
			ON CONFLICT (season_id, user_id) DO NOTHING`,
			s.SeasonID, s.UserID, s.FinalRank, s.FinalPoints, s.Percentile, rewardsJSON)
	}
	br := tx.SendBatch(ctx, batch)
	for i := 0; i < len(snaps); i++ {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return fmt.Errorf("batch insert snapshot %d: %w", i, err)
		}
	}
	if err := br.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *pgSeasonSnapshotRepo) ListBySeason(ctx context.Context, seasonID uuid.UUID, limit, offset int) ([]*SeasonSnapshot, error) {
	const q = `SELECT id, season_id, user_id, final_rank, final_points, percentile, rewards_granted, captured_at
		FROM scoring.season_snapshots WHERE season_id = $1 ORDER BY final_rank LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, seasonID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*SeasonSnapshot
	for rows.Next() {
		s := &SeasonSnapshot{}
		var rewardsRaw []byte
		err := rows.Scan(&s.ID, &s.SeasonID, &s.UserID, &s.FinalRank, &s.FinalPoints,
			&s.Percentile, &rewardsRaw, &s.CapturedAt)
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal(rewardsRaw, &s.RewardsGranted)
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSeasonSnapshotRepo) GetByUser(ctx context.Context, seasonID, userID uuid.UUID) (*SeasonSnapshot, error) {
	const q = `SELECT id, season_id, user_id, final_rank, final_points, percentile, rewards_granted, captured_at
		FROM scoring.season_snapshots WHERE season_id = $1 AND user_id = $2`
	s := &SeasonSnapshot{}
	var rewardsRaw []byte
	err := r.pool.QueryRow(ctx, q, seasonID, userID).Scan(
		&s.ID, &s.SeasonID, &s.UserID, &s.FinalRank, &s.FinalPoints,
		&s.Percentile, &rewardsRaw, &s.CapturedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(rewardsRaw, &s.RewardsGranted)
	return s, nil
}

// =============================================================================
// ELO repo
// =============================================================================

type pgELORepo struct{ pool *pgxpool.Pool }

func NewPGELORepo(pool *pgxpool.Pool) ELORepository {
	return &pgELORepo{pool: pool}
}

func (r *pgELORepo) Get(ctx context.Context, userID uuid.UUID) (*ELORating, error) {
	const q = `SELECT user_id, rating, peak_rating, matches_played, wins, losses, draws,
		last_match_at, last_decay_at, is_provisional, updated_at
		FROM scoring.elo_ratings WHERE user_id = $1`
	rating := &ELORating{}
	var lastMatchAt, lastDecayAt *time.Time
	err := r.pool.QueryRow(ctx, q, userID).Scan(
		&rating.UserID, &rating.Rating, &rating.PeakRating, &rating.MatchesPlayed,
		&rating.Wins, &rating.Losses, &rating.Draws,
		&lastMatchAt, &lastDecayAt, &rating.IsProvisional, &rating.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rating.LastMatchAt = lastMatchAt
	rating.LastDecayAt = lastDecayAt
	return rating, nil
}

func (r *pgELORepo) Upsert(ctx context.Context, e *ELORating) error {
	const q = `INSERT INTO scoring.elo_ratings
		(user_id, rating, peak_rating, matches_played, wins, losses, draws,
		 last_match_at, last_decay_at, is_provisional)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (user_id) DO UPDATE SET
			rating = EXCLUDED.rating,
			peak_rating = GREATEST(scoring.elo_ratings.peak_rating, EXCLUDED.peak_rating),
			matches_played = EXCLUDED.matches_played,
			wins = EXCLUDED.wins,
			losses = EXCLUDED.losses,
			draws = EXCLUDED.draws,
			last_match_at = EXCLUDED.last_match_at,
			last_decay_at = EXCLUDED.last_decay_at,
			is_provisional = EXCLUDED.is_provisional,
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		e.UserID, e.Rating, e.PeakRating, e.MatchesPlayed, e.Wins, e.Losses, e.Draws,
		e.LastMatchAt, e.LastDecayAt, e.IsProvisional,
	)
	return err
}

func (r *pgELORepo) RecordMatch(ctx context.Context, m *ELOMatch) error {
	const q = `INSERT INTO scoring.elo_matches
		(match_id, player_a_id, player_b_id,
		 player_a_rating_before, player_b_rating_before, result,
		 player_a_rating_after, player_b_rating_after,
		 rating_delta, k_factor, match_duration_seconds, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, 0), COALESCE($12, NOW()))`
	_, err := r.pool.Exec(ctx, q,
		m.MatchID, m.PlayerAID, m.PlayerBID,
		m.PlayerARatingBefore, m.PlayerBRatingBefore, m.Result,
		m.PlayerARatingAfter, m.PlayerBRatingAfter,
		m.RatingDelta, m.KFactor, m.MatchDurationSeconds, m.CompletedAt,
	)
	return err
}

func (r *pgELORepo) GetMatchHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*ELOMatch, error) {
	const q = `SELECT id, match_id, player_a_id, player_b_id,
		player_a_rating_before, player_b_rating_before, result,
		player_a_rating_after, player_b_rating_after,
		rating_delta, k_factor, COALESCE(match_duration_seconds, 0), completed_at
		FROM scoring.elo_matches WHERE player_a_id = $1 OR player_b_id = $1
		ORDER BY completed_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ELOMatch
	for rows.Next() {
		m := &ELOMatch{}
		err := rows.Scan(&m.ID, &m.MatchID, &m.PlayerAID, &m.PlayerBID,
			&m.PlayerARatingBefore, &m.PlayerBRatingBefore, &m.Result,
			&m.PlayerARatingAfter, &m.PlayerBRatingAfter,
			&m.RatingDelta, &m.KFactor, &m.MatchDurationSeconds, &m.CompletedAt)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *pgELORepo) ListTop(ctx context.Context, limit, offset int) ([]*ELORating, error) {
	const q = `SELECT user_id, rating, peak_rating, matches_played, wins, losses, draws,
		last_match_at, last_decay_at, is_provisional, updated_at
		FROM scoring.elo_ratings WHERE matches_played >= 5
		ORDER BY rating DESC LIMIT $1 OFFSET $2`
	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ELORating
	for rows.Next() {
		rating := &ELORating{}
		var lastMatchAt, lastDecayAt *time.Time
		err := rows.Scan(&rating.UserID, &rating.Rating, &rating.PeakRating,
			&rating.MatchesPlayed, &rating.Wins, &rating.Losses, &rating.Draws,
			&lastMatchAt, &lastDecayAt, &rating.IsProvisional, &rating.UpdatedAt)
		if err != nil {
			return nil, err
		}
		rating.LastMatchAt = lastMatchAt
		rating.LastDecayAt = lastDecayAt
		out = append(out, rating)
	}
	return out, rows.Err()
}

func (r *pgELORepo) ListInactive(ctx context.Context, before time.Time, limit int) ([]*ELORating, error) {
	const q = `SELECT user_id, rating, peak_rating, matches_played, wins, losses, draws,
		last_match_at, last_decay_at, is_provisional, updated_at
		FROM scoring.elo_ratings
		WHERE matches_played > 0 AND (last_match_at IS NULL OR last_match_at < $1)
		  AND (last_decay_at IS NULL OR last_decay_at < $1)
		  AND rating > 1500
		LIMIT $2`
	rows, err := r.pool.Query(ctx, q, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ELORating
	for rows.Next() {
		rating := &ELORating{}
		var lastMatchAt, lastDecayAt *time.Time
		err := rows.Scan(&rating.UserID, &rating.Rating, &rating.PeakRating,
			&rating.MatchesPlayed, &rating.Wins, &rating.Losses, &rating.Draws,
			&lastMatchAt, &lastDecayAt, &rating.IsProvisional, &rating.UpdatedAt)
		if err != nil {
			return nil, err
		}
		rating.LastMatchAt = lastMatchAt
		rating.LastDecayAt = lastDecayAt
		out = append(out, rating)
	}
	return out, rows.Err()
}

// =============================================================================
// Daily Activity repo
// =============================================================================

type pgDailyActivityRepo struct{ pool *pgxpool.Pool }

func NewPGDailyActivityRepo(pool *pgxpool.Pool) DailyActivityRepository {
	return &pgDailyActivityRepo{pool: pool}
}

func (r *pgDailyActivityRepo) Upsert(ctx context.Context, a *DailyActivity) error {
	const q = `INSERT INTO scoring.daily_activity
		(user_id, activity_date, points_earned, solves_count, first_solve_at, last_solve_at)
		VALUES ($1, $2::date, $3, $4, $5, $6)
		ON CONFLICT (user_id, activity_date) DO UPDATE SET
			points_earned = scoring.daily_activity.points_earned + EXCLUDED.points_earned,
			solves_count = scoring.daily_activity.solves_count + EXCLUDED.solves_count,
			first_solve_at = COALESCE(scoring.daily_activity.first_solve_at, EXCLUDED.first_solve_at),
			last_solve_at = EXCLUDED.last_solve_at`
	_, err := r.pool.Exec(ctx, q,
		a.UserID, a.ActivityDate, a.PointsEarned, a.SolvesCount, a.FirstSolveAt, a.LastSolveAt,
	)
	return err
}

func (r *pgDailyActivityRepo) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (*DailyActivity, error) {
	const q = `SELECT user_id, activity_date, points_earned, solves_count, first_solve_at, last_solve_at
		FROM scoring.daily_activity WHERE user_id = $1 AND activity_date = $2::date`
	a := &DailyActivity{}
	var firstAt, lastAt *time.Time
	err := r.pool.QueryRow(ctx, q, userID, date).Scan(
		&a.UserID, &a.ActivityDate, &a.PointsEarned, &a.SolvesCount, &firstAt, &lastAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.FirstSolveAt = firstAt
	a.LastSolveAt = lastAt
	return a, nil
}

func (r *pgDailyActivityRepo) ListRecent(ctx context.Context, userID uuid.UUID, days int) ([]*DailyActivity, error) {
	const q = `SELECT user_id, activity_date, points_earned, solves_count, first_solve_at, last_solve_at
		FROM scoring.daily_activity
		WHERE user_id = $1 AND activity_date >= (CURRENT_DATE - $2::int)
		ORDER BY activity_date DESC`
	rows, err := r.pool.Query(ctx, q, userID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DailyActivity
	for rows.Next() {
		a := &DailyActivity{}
		var firstAt, lastAt *time.Time
		err := rows.Scan(&a.UserID, &a.ActivityDate, &a.PointsEarned, &a.SolvesCount, &firstAt, &lastAt)
		if err != nil {
			return nil, err
		}
		a.FirstSolveAt = firstAt
		a.LastSolveAt = lastAt
		out = append(out, a)
	}
	return out, rows.Err()
}

// =============================================================================
// Cheat Flag repo
// =============================================================================

type pgCheatFlagRepo struct{ pool *pgxpool.Pool }

func NewPGCheatFlagRepo(pool *pgxpool.Pool) CheatFlagRepository {
	return &pgCheatFlagRepo{pool: pool}
}

func (r *pgCheatFlagRepo) Insert(ctx context.Context, f *CheatFlag) error {
	evidenceJSON, _ := json.Marshal(f.Evidence)
	if len(evidenceJSON) == 0 {
		evidenceJSON = []byte("{}")
	}
	const q = `INSERT INTO scoring.cheat_flags
		(user_id, flag_type, severity, confidence, evidence, submission_ids, status)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE(NULLIF($7, ''), 'pending'))`
	_, err := r.pool.Exec(ctx, q,
		f.UserID, f.FlagType, f.Severity, f.Confidence, evidenceJSON, f.SubmissionIDs, f.Status,
	)
	return err
}

func (r *pgCheatFlagRepo) ListPending(ctx context.Context, limit, offset int) ([]*CheatFlag, error) {
	const q = `SELECT id, user_id, flag_type, severity, confidence, evidence, submission_ids,
		status, reviewer_id, COALESCE(review_notes, ''), COALESCE(action_taken, ''),
		detected_at, reviewed_at
		FROM scoring.cheat_flags WHERE status IN ('pending', 'reviewing')
		ORDER BY severity DESC, detected_at ASC LIMIT $1 OFFSET $2`
	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCheatFlags(rows)
}

func (r *pgCheatFlagRepo) GetByID(ctx context.Context, id uuid.UUID) (*CheatFlag, error) {
	const q = `SELECT id, user_id, flag_type, severity, confidence, evidence, submission_ids,
		status, reviewer_id, COALESCE(review_notes, ''), COALESCE(action_taken, ''),
		detected_at, reviewed_at
		FROM scoring.cheat_flags WHERE id = $1`
	return scanCheatFlag(r.pool.QueryRow(ctx, q, id))
}

func (r *pgCheatFlagRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status string, reviewerID uuid.UUID, notes, action string) error {
	const q = `UPDATE scoring.cheat_flags SET status = $2, reviewer_id = $3,
		review_notes = NULLIF($4, ''), action_taken = NULLIF($5, ''), reviewed_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, status, reviewerID, notes, action)
	return err
}

func (r *pgCheatFlagRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]*CheatFlag, error) {
	const q = `SELECT id, user_id, flag_type, severity, confidence, evidence, submission_ids,
		status, reviewer_id, COALESCE(review_notes, ''), COALESCE(action_taken, ''),
		detected_at, reviewed_at
		FROM scoring.cheat_flags WHERE user_id = $1 ORDER BY detected_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCheatFlags(rows)
}

func scanCheatFlag(row pgx.Row) (*CheatFlag, error) {
	f := &CheatFlag{}
	var (
		evidenceRaw []byte
		reviewerID  *uuid.UUID
		reviewedAt  *time.Time
	)
	err := row.Scan(
		&f.ID, &f.UserID, &f.FlagType, &f.Severity, &f.Confidence, &evidenceRaw, &f.SubmissionIDs,
		&f.Status, &reviewerID, &f.ReviewNotes, &f.ActionTaken, &f.DetectedAt, &reviewedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if len(evidenceRaw) > 0 {
		_ = json.Unmarshal(evidenceRaw, &f.Evidence)
	}
	f.ReviewerID = reviewerID
	f.ReviewedAt = reviewedAt
	return f, nil
}

func scanCheatFlags(rows pgx.Rows) ([]*CheatFlag, error) {
	var out []*CheatFlag
	for rows.Next() {
		f, err := scanCheatFlag(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
