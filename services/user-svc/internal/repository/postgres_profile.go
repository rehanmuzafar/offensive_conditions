package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type pgProfileRepo struct{ pool *pgxpool.Pool }

func NewPGProfileRepo(pool *pgxpool.Pool) ProfileRepository {
	return &pgProfileRepo{pool: pool}
}

const profileSelectColumns = `
	p.user_id, COALESCE(u.username, ''), COALESCE(u.email, ''),
	COALESCE(p.display_name, ''), COALESCE(p.bio, ''),
	COALESCE(p.avatar_url, ''), COALESCE(p.avatar_storage_key, ''),
	COALESCE(p.country_code, ''), COALESCE(p.timezone, 'UTC'),
	COALESCE(p.language, 'en'),
	COALESCE(s.tier, 'free'),
	COALESCE((u.role IN ('admin', 'moderator', 'support')), FALSE),
	COALESCE(p.is_verified_human, FALSE),
	COALESCE(u.email_verified, FALSE),
	COALESCE(p.twitter_handle, ''), COALESCE(p.github_handle, ''),
	COALESCE(p.linkedin_url, ''), COALESCE(p.website_url, ''),
	COALESCE(p.profile_visibility, 'public'),
	COALESCE(p.show_country, TRUE),
	COALESCE(p.show_team, TRUE),
	COALESCE(p.show_achievements, TRUE),
	COALESCE(p.show_on_leaderboard, TRUE),
	COALESCE(p.allow_friend_requests, TRUE),
	COALESCE(p.allow_messages, 'anyone'),
	COALESCE(p.onboarding_complete, FALSE),
	p.created_at, p.updated_at, u.last_seen_at`

const profileSelectFrom = `users.profiles p
	LEFT JOIN auth.users u ON u.id = p.user_id
	LEFT JOIN users.subscriptions s ON s.user_id = p.user_id AND s.status = 'active'`

func scanProfile(row pgx.Row) (*Profile, error) {
	p := &Profile{}
	var lastSeen *time.Time
	err := row.Scan(
		&p.UserID, &p.Username, &p.Email,
		&p.DisplayName, &p.Bio,
		&p.AvatarURL, &p.AvatarStorageKey,
		&p.CountryCode, &p.Timezone,
		&p.Locale,
		&p.Tier, &p.IsStaff,
		&p.IsVerifiedHuman,
		&p.EmailVerified,
		&p.TwitterHandle, &p.GitHubHandle,
		&p.LinkedInURL, &p.PersonalSiteURL,
		&p.Privacy.ProfileVisibility,
		&p.Privacy.ShowCountry,
		&p.Privacy.ShowTeam,
		&p.Privacy.ShowAchievements,
		&p.Privacy.ShowOnLeaderboard,
		&p.Privacy.AllowFriendRequests,
		&p.Privacy.AllowMessages,
		&p.OnboardingComplete,
		&p.CreatedAt, &p.UpdatedAt, &lastSeen,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.LastSeenAt = lastSeen
	return p, nil
}

func (r *pgProfileRepo) Get(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	q := `SELECT ` + profileSelectColumns + ` FROM ` + profileSelectFrom + `
		WHERE p.user_id = $1`
	return scanProfile(r.pool.QueryRow(ctx, q, userID))
}

func (r *pgProfileRepo) GetByUsername(ctx context.Context, username string) (*Profile, error) {
	q := `SELECT ` + profileSelectColumns + ` FROM ` + profileSelectFrom + `
		WHERE LOWER(u.username) = LOWER($1)`
	return scanProfile(r.pool.QueryRow(ctx, q, username))
}

func (r *pgProfileRepo) BatchGet(ctx context.Context, userIDs []uuid.UUID) (map[uuid.UUID]*Profile, error) {
	if len(userIDs) == 0 {
		return map[uuid.UUID]*Profile{}, nil
	}
	q := `SELECT ` + profileSelectColumns + ` FROM ` + profileSelectFrom + `
		WHERE p.user_id = ANY($1)`
	rows, err := r.pool.Query(ctx, q, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[uuid.UUID]*Profile, len(userIDs))
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		out[p.UserID] = p
	}
	return out, rows.Err()
}

func (r *pgProfileRepo) Create(ctx context.Context, p *Profile) error {
	const q = `INSERT INTO users.profiles
		(user_id, display_name, bio, country_code, timezone, language,
		 profile_visibility, show_country, show_team, show_achievements,
		 show_on_leaderboard, allow_friend_requests, allow_messages,
		 onboarding_complete, created_at, updated_at)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), $5, $6,
		        $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
		ON CONFLICT (user_id) DO NOTHING`
	_, err := r.pool.Exec(ctx, q,
		p.UserID, p.DisplayName, p.Bio, p.CountryCode, p.Timezone, p.Locale,
		p.Privacy.ProfileVisibility, p.Privacy.ShowCountry, p.Privacy.ShowTeam,
		p.Privacy.ShowAchievements, p.Privacy.ShowOnLeaderboard,
		p.Privacy.AllowFriendRequests, p.Privacy.AllowMessages,
		p.OnboardingComplete,
	)
	return err
}

func (r *pgProfileRepo) UpdateBio(ctx context.Context, userID uuid.UUID, bio string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users.profiles SET bio = NULLIF($2, ''), updated_at = NOW() WHERE user_id = $1`, userID, bio)
	return err
}

func (r *pgProfileRepo) UpdateDisplayName(ctx context.Context, userID uuid.UUID, name string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users.profiles SET display_name = NULLIF($2, ''), updated_at = NOW() WHERE user_id = $1`, userID, name)
	return err
}

func (r *pgProfileRepo) UpdateCountry(ctx context.Context, userID uuid.UUID, code string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users.profiles SET country_code = NULLIF(UPPER($2), ''), updated_at = NOW() WHERE user_id = $1`, userID, code)
	return err
}

func (r *pgProfileRepo) UpdateTimezone(ctx context.Context, userID uuid.UUID, tz string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users.profiles SET timezone = $2, updated_at = NOW() WHERE user_id = $1`, userID, tz)
	return err
}

func (r *pgProfileRepo) UpdateSocialLinks(ctx context.Context, userID uuid.UUID, twitter, github, linkedin, site string) error {
	const q = `UPDATE users.profiles SET
		twitter_handle = NULLIF($2, ''),
		github_handle = NULLIF($3, ''),
		linkedin_url = NULLIF($4, ''),
		website_url = NULLIF($5, ''),
		updated_at = NOW()
		WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID, twitter, github, linkedin, site)
	return err
}

func (r *pgProfileRepo) UpdateAvatar(ctx context.Context, userID uuid.UUID, url, storageKey string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.profiles SET avatar_url = NULLIF($2, ''), avatar_storage_key = NULLIF($3, ''), updated_at = NOW() WHERE user_id = $1`,
		userID, url, storageKey)
	return err
}

func (r *pgProfileRepo) UpdatePrivacy(ctx context.Context, userID uuid.UUID, p PrivacySettings) error {
	const q = `UPDATE users.profiles SET
		profile_visibility = $2,
		show_country = $3,
		show_team = $4,
		show_achievements = $5,
		show_on_leaderboard = $6,
		allow_friend_requests = $7,
		allow_messages = $8,
		updated_at = NOW()
		WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID,
		p.ProfileVisibility, p.ShowCountry, p.ShowTeam, p.ShowAchievements,
		p.ShowOnLeaderboard, p.AllowFriendRequests, p.AllowMessages,
	)
	return err
}

func (r *pgProfileRepo) UpdateLastSeen(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE auth.users SET last_seen_at = NOW() WHERE id = $1`, userID)
	return err
}

func (r *pgProfileRepo) MarkEmailVerified(ctx context.Context, userID uuid.UUID) error {
	// Auth service is the source of truth; we still want the user_svc to know.
	// In practice this is reflected via auth.users.email_verified which we JOIN.
	// This is a no-op stub for explicit triggering.
	_, err := r.pool.Exec(ctx,
		`UPDATE users.profiles SET updated_at = NOW() WHERE user_id = $1`, userID)
	return err
}

func (r *pgProfileRepo) Delete(ctx context.Context, userID uuid.UUID) error {
	// Soft delete: scrub PII but keep row for referential integrity from teams/etc
	const q = `UPDATE users.profiles SET
		display_name = '[deleted]',
		bio = NULL,
		avatar_url = NULL,
		avatar_storage_key = NULL,
		country_code = NULL,
		twitter_handle = NULL,
		github_handle = NULL,
		linkedin_url = NULL,
		website_url = NULL,
		profile_visibility = 'private',
		updated_at = NOW()
		WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

func (r *pgProfileRepo) SearchByUsername(ctx context.Context, prefix string, country string, limit int) ([]*Profile, error) {
	// Trigram + prefix match; auth.users.username has a trigram GIN index.
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	args := []any{prefix + "%", limit}
	countryFilter := ""
	if country != "" {
		args = append(args, strings.ToUpper(country))
		countryFilter = " AND p.country_code = $3"
	}
	q := `SELECT ` + profileSelectColumns + ` FROM ` + profileSelectFrom + `
		WHERE LOWER(u.username) LIKE $1
		AND COALESCE(p.profile_visibility, 'public') = 'public'` +
		countryFilter + `
		ORDER BY u.username ASC LIMIT $2`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *pgProfileRepo) CountByCountry(ctx context.Context, code string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users.profiles WHERE country_code = UPPER($1)`,
		code).Scan(&n)
	return n, err
}
