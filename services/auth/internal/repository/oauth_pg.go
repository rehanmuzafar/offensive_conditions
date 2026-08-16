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

// pgOAuthLinkRepo implements OAuthLinkRepository.
type pgOAuthLinkRepo struct {
	pool *pgxpool.Pool
}

func NewPGOAuthLinkRepo(pool *pgxpool.Pool) OAuthLinkRepository {
	return &pgOAuthLinkRepo{pool: pool}
}

func (r *pgOAuthLinkRepo) Create(ctx context.Context, link *OAuthLink) error {
	const q = `
		INSERT INTO auth.oauth_links
			(id, user_id, provider, provider_user_id, provider_email,
			 access_token_encrypted, refresh_token_encrypted, metadata)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), $8)
		ON CONFLICT (provider, provider_user_id) DO UPDATE
			SET access_token_encrypted = EXCLUDED.access_token_encrypted,
			    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
			    metadata = EXCLUDED.metadata,
			    updated_at = NOW()
		RETURNING id, created_at, updated_at`
	if link.ID == uuid.Nil {
		link.ID = uuid.New()
	}
	metaJSON, _ := json.Marshal(link.Metadata)
	if link.Metadata == nil {
		metaJSON = []byte("{}")
	}

	row := r.pool.QueryRow(ctx, q,
		link.ID, link.UserID, link.Provider, link.ProviderUserID, link.ProviderEmail,
		link.AccessTokenEncrypted, link.RefreshTokenEncrypted, metaJSON,
	)
	var (
		createdAt, updatedAt time.Time
		id                   uuid.UUID
	)
	if err := row.Scan(&id, &createdAt, &updatedAt); err != nil {
		return fmt.Errorf("upsert oauth link: %w", err)
	}
	link.ID = id
	link.CreatedAt = createdAt
	link.UpdatedAt = updatedAt
	return nil
}

func (r *pgOAuthLinkRepo) GetByProviderID(ctx context.Context, provider, providerUserID string) (*OAuthLink, error) {
	const q = `
		SELECT id, user_id, provider, provider_user_id, provider_email,
		       COALESCE(access_token_encrypted, ''), COALESCE(refresh_token_encrypted, ''),
		       metadata, created_at, updated_at
		FROM auth.oauth_links
		WHERE provider = $1 AND provider_user_id = $2`

	link := &OAuthLink{}
	var (
		providerEmail *string
		metaRaw       []byte
	)
	err := r.pool.QueryRow(ctx, q, provider, providerUserID).Scan(
		&link.ID, &link.UserID, &link.Provider, &link.ProviderUserID, &providerEmail,
		&link.AccessTokenEncrypted, &link.RefreshTokenEncrypted,
		&metaRaw, &link.CreatedAt, &link.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get oauth link: %w", err)
	}
	if providerEmail != nil {
		link.ProviderEmail = *providerEmail
	}
	if len(metaRaw) > 0 {
		_ = json.Unmarshal(metaRaw, &link.Metadata)
	}
	return link, nil
}

func (r *pgOAuthLinkRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]*OAuthLink, error) {
	const q = `
		SELECT id, user_id, provider, provider_user_id, COALESCE(provider_email, ''),
		       COALESCE(access_token_encrypted, ''), COALESCE(refresh_token_encrypted, ''),
		       metadata, created_at, updated_at
		FROM auth.oauth_links
		WHERE user_id = $1
		ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("query oauth links: %w", err)
	}
	defer rows.Close()

	var out []*OAuthLink
	for rows.Next() {
		link := &OAuthLink{}
		var metaRaw []byte
		err := rows.Scan(
			&link.ID, &link.UserID, &link.Provider, &link.ProviderUserID, &link.ProviderEmail,
			&link.AccessTokenEncrypted, &link.RefreshTokenEncrypted,
			&metaRaw, &link.CreatedAt, &link.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &link.Metadata)
		}
		out = append(out, link)
	}
	return out, rows.Err()
}

func (r *pgOAuthLinkRepo) Delete(ctx context.Context, id uuid.UUID) error {
	const q = `DELETE FROM auth.oauth_links WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id)
	return err
}
