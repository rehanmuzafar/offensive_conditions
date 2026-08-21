package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type pgTeamRepo struct{ pool *pgxpool.Pool }

func NewPGTeamRepo(pool *pgxpool.Pool) TeamRepository {
	return &pgTeamRepo{pool: pool}
}

const teamSelectColumns = `id, name, slug, COALESCE(description, ''),
	COALESCE(avatar_url, ''), COALESCE(banner_url, ''),
	COALESCE(country_code, ''), COALESCE(website, ''),
	category, COALESCE(category_detail, ''),
	is_private, is_recruiting, max_members, owner_id,
	member_count, created_at, updated_at, disbanded_at`

func scanTeam(row pgx.Row) (*Team, error) {
	t := &Team{}
	var disbanded *time.Time
	err := row.Scan(
		&t.ID, &t.Name, &t.Slug, &t.Description,
		&t.AvatarURL, &t.BannerURL,
		&t.CountryCode, &t.Website,
		&t.Category, &t.CategoryDetail,
		&t.IsPrivate, &t.IsRecruiting, &t.MaxMembers, &t.OwnerID,
		&t.MemberCount, &t.CreatedAt, &t.UpdatedAt, &disbanded,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	t.DisbandedAt = disbanded
	return t, nil
}

func (r *pgTeamRepo) Get(ctx context.Context, teamID uuid.UUID) (*Team, error) {
	q := `SELECT ` + teamSelectColumns + ` FROM users.teams WHERE id = $1`
	return scanTeam(r.pool.QueryRow(ctx, q, teamID))
}

func (r *pgTeamRepo) GetBySlug(ctx context.Context, slug string) (*Team, error) {
	q := `SELECT ` + teamSelectColumns + ` FROM users.teams WHERE LOWER(slug) = LOWER($1)`
	return scanTeam(r.pool.QueryRow(ctx, q, slug))
}

func (r *pgTeamRepo) Create(ctx context.Context, t *Team) error {
	const q = `INSERT INTO users.teams
		(id, name, slug, description, avatar_url, banner_url, country_code,
		 website, category, category_detail, is_private, is_recruiting,
		 max_members, owner_id, member_count, created_at, updated_at)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''),
		        NULLIF(UPPER($7), ''), NULLIF($8, ''),
		        COALESCE(NULLIF($14, ''), 'open'), NULLIF($15, ''),
		        $9, $10, $11, $12, $13, NOW(), NOW())
		RETURNING created_at, updated_at`
	// RETURNING the timestamps: without them the caller serialised the zero
	// time ("0001-01-01T00:00:00Z") back to the client.
	err := r.pool.QueryRow(ctx, q,
		t.ID, t.Name, t.Slug, t.Description, t.AvatarURL, t.BannerURL, t.CountryCode,
		t.Website, t.IsPrivate, t.IsRecruiting, t.MaxMembers, t.OwnerID, t.MemberCount,
		t.Category, t.CategoryDetail,
	).Scan(&t.CreatedAt, &t.UpdatedAt)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

func (r *pgTeamRepo) Update(ctx context.Context, t *Team) error {
	// category is deliberately absent: it is no longer set from the UI, and
	// leaving it out keeps existing rows valid against chk_team_category.
	const q = `UPDATE users.teams SET
		name = $2, description = NULLIF($3, ''),
		avatar_url = NULLIF($4, ''), banner_url = NULLIF($5, ''),
		country_code = NULLIF(UPPER($6), ''), website = NULLIF($7, ''),
		is_private = $8, is_recruiting = $9, max_members = $10,
		owner_id = $11, category_detail = NULLIF($12, ''), updated_at = NOW()
		WHERE id = $1 AND disbanded_at IS NULL`
	_, err := r.pool.Exec(ctx, q,
		t.ID, t.Name, t.Description, t.AvatarURL, t.BannerURL,
		t.CountryCode, t.Website, t.IsPrivate, t.IsRecruiting, t.MaxMembers, t.OwnerID,
		t.CategoryDetail,
	)
	return err
}

func (r *pgTeamRepo) Disband(ctx context.Context, teamID uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE users.team_members SET left_at = NOW() WHERE team_id = $1 AND left_at IS NULL`,
		teamID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users.teams SET status = 'disbanded', disbanded_at = NOW(), member_count = 0, updated_at = NOW() WHERE id = $1`,
		teamID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *pgTeamRepo) IncrementMemberCount(ctx context.Context, teamID uuid.UUID, delta int) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.teams SET member_count = GREATEST(0, member_count + $2), updated_at = NOW() WHERE id = $1`,
		teamID, delta)
	return err
}

func (r *pgTeamRepo) ListByMember(ctx context.Context, userID uuid.UUID) ([]*Team, error) {
	q := `SELECT ` + teamSelectColumns + ` FROM users.teams t
		INNER JOIN users.team_members m ON m.team_id = t.id
		WHERE m.user_id = $1 AND m.left_at IS NULL AND t.disbanded_at IS NULL
		ORDER BY m.joined_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var teams []*Team
	for rows.Next() {
		t, err := scanTeam(rows)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		teams = append(teams, t)
	}
	return teams, rows.Err()
}

func (r *pgTeamRepo) CountByMember(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users.team_members m
		INNER JOIN users.teams t ON t.id = m.team_id
		WHERE m.user_id = $1 AND m.left_at IS NULL AND t.disbanded_at IS NULL`, userID).Scan(&n)
	return n, err
}

// =============================================================================
// Memberships
// =============================================================================

func (r *pgTeamRepo) AddMember(ctx context.Context, m *TeamMembership) error {
	const q = `INSERT INTO users.team_members (team_id, user_id, role, joined_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (team_id, user_id) DO UPDATE SET
			role = EXCLUDED.role,
			joined_at = NOW(),
			left_at = NULL`
	_, err := r.pool.Exec(ctx, q, m.TeamID, m.UserID, m.Role)
	return err
}

func (r *pgTeamRepo) RemoveMember(ctx context.Context, teamID, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.team_members SET left_at = NOW() WHERE team_id = $1 AND user_id = $2 AND left_at IS NULL`,
		teamID, userID)
	return err
}

func (r *pgTeamRepo) UpdateMemberRole(ctx context.Context, teamID, userID uuid.UUID, role string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.team_members SET role = $3 WHERE team_id = $1 AND user_id = $2 AND left_at IS NULL`,
		teamID, userID, role)
	return err
}

func (r *pgTeamRepo) ListMembers(ctx context.Context, teamID uuid.UUID) ([]*TeamMembership, error) {
	// The name lives in auth.users; users.profiles carries the display name and
	// the rest. Both are joined because a roster wants the handle, and the
	// display name only when someone set one.
	q := `SELECT m.team_id, m.user_id, m.role,
			COALESCE(u.username, ''), COALESCE(p.display_name, ''),
			COALESCE(p.avatar_url, ''), COALESCE(p.country_code, ''),
			m.joined_at, m.left_at
		FROM users.team_members m
		LEFT JOIN auth.users u ON u.id = m.user_id
		LEFT JOIN users.profiles p ON p.user_id = m.user_id
		WHERE m.team_id = $1 AND m.left_at IS NULL
		ORDER BY (m.role = 'captain') DESC, m.joined_at ASC`
	rows, err := r.pool.Query(ctx, q, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*TeamMembership
	for rows.Next() {
		m := &TeamMembership{}
		if err := rows.Scan(
			&m.TeamID, &m.UserID, &m.Role,
			&m.Username, &m.DisplayName, &m.AvatarURL, &m.CountryCode,
			&m.JoinedAt, &m.LeftAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *pgTeamRepo) GetMembership(ctx context.Context, teamID, userID uuid.UUID) (*TeamMembership, error) {
	m := &TeamMembership{}
	err := r.pool.QueryRow(ctx,
		`SELECT team_id, user_id, role, joined_at, left_at FROM users.team_members
		 WHERE team_id = $1 AND user_id = $2`, teamID, userID).
		Scan(&m.TeamID, &m.UserID, &m.Role, &m.JoinedAt, &m.LeftAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// =============================================================================
// Invitations
// =============================================================================

func (r *pgTeamRepo) CreateInvitation(ctx context.Context, inv *TeamInvitation) error {
	// Phase 2 schema requires token_hash (unique); generate it from the invitation ID.
	tokenHash := inv.ID.String()
	const q = `INSERT INTO users.team_invitations
		(id, team_id, inviter_id, invitee_id, token_hash, status, message, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NOW(), $8)`
	_, err := r.pool.Exec(ctx, q,
		inv.ID, inv.TeamID, inv.InviterID, inv.InviteeID, tokenHash, inv.Status, inv.Message, inv.ExpiresAt)
	return err
}

func (r *pgTeamRepo) GetInvitation(ctx context.Context, invID uuid.UUID) (*TeamInvitation, error) {
	inv := &TeamInvitation{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, team_id, inviter_id, invitee_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.team_invitations WHERE id = $1`,
		invID).Scan(
		&inv.ID, &inv.TeamID, &inv.InviterID, &inv.InviteeID, &inv.Status, &inv.Message,
		&inv.CreatedAt, &inv.RespondedAt, &inv.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return inv, err
}

func (r *pgTeamRepo) UpdateInvitationStatus(ctx context.Context, invID uuid.UUID, status string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.team_invitations SET status = $2, responded_at = NOW() WHERE id = $1 AND status = 'pending'`,
		invID, status)
	return err
}

func (r *pgTeamRepo) ListPendingInvitationsForUser(ctx context.Context, userID uuid.UUID) ([]*TeamInvitation, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, team_id, inviter_id, invitee_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.team_invitations
		WHERE invitee_id = $1 AND status = 'pending' AND expires_at > NOW()
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanInvitations(rows)
}

func (r *pgTeamRepo) ListPendingInvitationsForTeam(ctx context.Context, teamID uuid.UUID) ([]*TeamInvitation, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, team_id, inviter_id, invitee_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.team_invitations
		WHERE team_id = $1 AND status = 'pending' AND expires_at > NOW()
		ORDER BY created_at DESC`, teamID)
	if err != nil {
		return nil, err
	}
	return scanInvitations(rows)
}

func (r *pgTeamRepo) ExpireOldInvitations(ctx context.Context) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users.team_invitations SET status = 'expired', responded_at = NOW()
		WHERE status = 'pending' AND expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func scanInvitations(rows pgx.Rows) ([]*TeamInvitation, error) {
	defer rows.Close()
	var out []*TeamInvitation
	for rows.Next() {
		inv := &TeamInvitation{}
		if err := rows.Scan(
			&inv.ID, &inv.TeamID, &inv.InviterID, &inv.InviteeID, &inv.Status, &inv.Message,
			&inv.CreatedAt, &inv.RespondedAt, &inv.ExpiresAt,
		); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// ListPublic powers team discovery: browse by category, search by name.
// Private teams stay hidden — they are joinable by invitation only.
func (r *pgTeamRepo) ListPublic(
	ctx context.Context, f TeamFilter, limit, offset int,
) ([]*Team, error) {
	// The free-text box searches name, affiliation, slug, id and country in one
	// go, so a player can type "NUST", "Pakistan" or paste a team id without
	// first choosing which field they mean.
	//
	// The country half arrives as codes ($7): the caller turns "Pakistan" into
	// {PK} against the curated list, because matching a name here would need a
	// second copy of that list in SQL.
	sql := `SELECT ` + teamSelectColumns + ` FROM users.teams
		WHERE disbanded_at IS NULL AND is_private = FALSE
		  AND ($1 = '' OR name ILIKE '%' || $1 || '%'
		               OR COALESCE(category_detail, '') ILIKE '%' || $1 || '%'
		               OR COALESCE(slug, '') ILIKE '%' || $1 || '%'
		               OR id::text = $1
		               OR COALESCE(country_code, '') ILIKE $1
		               OR COALESCE(country_code, '') = ANY($7))
		  AND ($2 = '' OR category = $2)
		  AND ($3 = '' OR COALESCE(country_code, '') = $3)
		  AND ($4 = '' OR COALESCE(category_detail, '') ILIKE '%' || $4 || '%')
		ORDER BY member_count DESC, created_at DESC
		LIMIT $5 OFFSET $6`
	countryAny := f.CountryAny
	if countryAny == nil {
		countryAny = []string{}
	}
	rows, err := r.pool.Query(
		ctx, sql, f.Query, f.Category, f.CountryCode, f.Detail, limit, offset, countryAny,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Team
	for rows.Next() {
		t, err := scanTeam(rows)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *pgTeamRepo) CreateJoinRequest(ctx context.Context, jr *TeamJoinRequest) error {
	const q = `INSERT INTO users.team_join_requests (id, team_id, user_id, message)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		RETURNING created_at, status`
	if jr.ID == uuid.Nil {
		jr.ID = uuid.New()
	}
	err := r.pool.QueryRow(ctx, q, jr.ID, jr.TeamID, jr.UserID, jr.Message).
		Scan(&jr.CreatedAt, &jr.Status)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

const joinRequestColumns = `id, team_id, user_id, COALESCE(message, ''), status,
	decided_by, decided_at, created_at`

func scanJoinRequest(row pgx.Row) (*TeamJoinRequest, error) {
	jr := &TeamJoinRequest{}
	err := row.Scan(&jr.ID, &jr.TeamID, &jr.UserID, &jr.Message, &jr.Status,
		&jr.DecidedBy, &jr.DecidedAt, &jr.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return jr, err
}

func (r *pgTeamRepo) ListJoinRequests(ctx context.Context, teamID uuid.UUID) ([]*TeamJoinRequest, error) {
	q := `SELECT ` + joinRequestColumns + ` FROM users.team_join_requests
		WHERE team_id = $1 AND status = 'pending' ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*TeamJoinRequest
	for rows.Next() {
		jr, err := scanJoinRequest(rows)
		if err != nil {
			continue
		}
		out = append(out, jr)
	}
	return out, rows.Err()
}

func (r *pgTeamRepo) GetJoinRequest(ctx context.Context, id uuid.UUID) (*TeamJoinRequest, error) {
	q := `SELECT ` + joinRequestColumns + ` FROM users.team_join_requests WHERE id = $1`
	return scanJoinRequest(r.pool.QueryRow(ctx, q, id))
}

func (r *pgTeamRepo) DecideJoinRequest(
	ctx context.Context, id uuid.UUID, status string, deciderID uuid.UUID,
) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.team_join_requests
		 SET status = $2, decided_by = $3, decided_at = NOW()
		 WHERE id = $1 AND status = 'pending'`, id, status, deciderID)
	return err
}
