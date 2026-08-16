package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type pgFriendRepo struct{ pool *pgxpool.Pool }

func NewPGFriendRepo(pool *pgxpool.Pool) FriendRepository {
	return &pgFriendRepo{pool: pool}
}

// orderPair returns (a, b) where a < b so we always store friendships consistently.
func orderPair(x, y uuid.UUID) (uuid.UUID, uuid.UUID) {
	xs := x.String()
	ys := y.String()
	if xs < ys {
		return x, y
	}
	return y, x
}

// =============================================================================
// Friend Requests
// =============================================================================

func (r *pgFriendRepo) CreateRequest(ctx context.Context, req *FriendRequest) error {
	const q = `INSERT INTO users.friend_requests
		(id, requester_id, receiver_id, status, message, created_at, expires_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NOW(), $6)`
	_, err := r.pool.Exec(ctx, q,
		req.ID, req.RequesterID, req.ReceiverID, req.Status, req.Message, req.ExpiresAt)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

func (r *pgFriendRepo) GetRequest(ctx context.Context, id uuid.UUID) (*FriendRequest, error) {
	req := &FriendRequest{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, requester_id, receiver_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.friend_requests WHERE id = $1`, id).
		Scan(&req.ID, &req.RequesterID, &req.ReceiverID, &req.Status, &req.Message,
			&req.CreatedAt, &req.RespondedAt, &req.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return req, err
}

func (r *pgFriendRepo) UpdateRequestStatus(ctx context.Context, id uuid.UUID, status string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.friend_requests SET status = $2, responded_at = NOW()
		WHERE id = $1 AND status = 'pending'`, id, status)
	return err
}

func (r *pgFriendRepo) ListIncomingRequests(ctx context.Context, userID uuid.UUID) ([]*FriendRequest, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, requester_id, receiver_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.friend_requests
		WHERE receiver_id = $1 AND status = 'pending' AND expires_at > NOW()
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRequests(rows)
}

func (r *pgFriendRepo) ListOutgoingRequests(ctx context.Context, userID uuid.UUID) ([]*FriendRequest, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, requester_id, receiver_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.friend_requests
		WHERE requester_id = $1 AND status = 'pending' AND expires_at > NOW()
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanFriendRequests(rows)
}

func (r *pgFriendRepo) ExistingPendingBetween(ctx context.Context, a, b uuid.UUID) (*FriendRequest, error) {
	req := &FriendRequest{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, requester_id, receiver_id, status, COALESCE(message, ''),
			created_at, responded_at, expires_at
		FROM users.friend_requests
		WHERE status = 'pending' AND expires_at > NOW()
		  AND ((requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1))
		LIMIT 1`, a, b).
		Scan(&req.ID, &req.RequesterID, &req.ReceiverID, &req.Status, &req.Message,
			&req.CreatedAt, &req.RespondedAt, &req.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return req, err
}

func scanFriendRequests(rows pgx.Rows) ([]*FriendRequest, error) {
	defer rows.Close()
	var out []*FriendRequest
	for rows.Next() {
		req := &FriendRequest{}
		if err := rows.Scan(
			&req.ID, &req.RequesterID, &req.ReceiverID, &req.Status, &req.Message,
			&req.CreatedAt, &req.RespondedAt, &req.ExpiresAt,
		); err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// =============================================================================
// Friendships (canonical (a, b) ordering)
// =============================================================================

func (r *pgFriendRepo) AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error) {
	x, y := orderPair(a, b)
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users.friendships WHERE user_id_a = $1 AND user_id_b = $2)`,
		x, y).Scan(&exists)
	return exists, err
}

func (r *pgFriendRepo) AddFriendship(ctx context.Context, a, b uuid.UUID) error {
	x, y := orderPair(a, b)
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users.friendships (user_id_a, user_id_b, created_at)
		VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
		x, y)
	return err
}

func (r *pgFriendRepo) RemoveFriendship(ctx context.Context, a, b uuid.UUID) error {
	x, y := orderPair(a, b)
	_, err := r.pool.Exec(ctx,
		`DELETE FROM users.friendships WHERE user_id_a = $1 AND user_id_b = $2`,
		x, y)
	return err
}

func (r *pgFriendRepo) ListFriends(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT CASE WHEN user_id_a = $1 THEN user_id_b ELSE user_id_a END
		FROM users.friendships WHERE user_id_a = $1 OR user_id_b = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *pgFriendRepo) CountFriends(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users.friendships WHERE user_id_a = $1 OR user_id_b = $1`,
		userID).Scan(&n)
	return n, err
}

// =============================================================================
// Blocks
// =============================================================================

func (r *pgFriendRepo) AddBlock(ctx context.Context, blocker, blocked uuid.UUID, reason string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users.user_blocks (blocker_id, blocked_id, reason, created_at)
		VALUES ($1, $2, NULLIF($3, ''), NOW())
		ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET reason = EXCLUDED.reason`,
		blocker, blocked, reason)
	return err
}

func (r *pgFriendRepo) RemoveBlock(ctx context.Context, blocker, blocked uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM users.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
		blocker, blocked)
	return err
}

func (r *pgFriendRepo) IsBlocked(ctx context.Context, blocker, blocked uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users.user_blocks WHERE blocker_id = $1 AND blocked_id = $2)`,
		blocker, blocked).Scan(&exists)
	return exists, err
}

func (r *pgFriendRepo) IsBlockedEither(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users.user_blocks
		WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))`,
		a, b).Scan(&exists)
	return exists, err
}

func (r *pgFriendRepo) ListBlocked(ctx context.Context, blocker uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT blocked_id FROM users.user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC`,
		blocker)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
