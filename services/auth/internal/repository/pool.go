package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolConfig is the subset of config needed to build a pool.
type PoolConfig struct {
	DSN             string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetimeSeconds int
	MaxConnIdleTimeSeconds int
	ConnectTimeoutSeconds  int
}

// NewPool builds a configured pgx connection pool and verifies connectivity.
func NewPool(ctx context.Context, c PoolConfig) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(c.DSN)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}

	if c.MaxConns > 0 {
		cfg.MaxConns = c.MaxConns
	}
	if c.MinConns > 0 {
		cfg.MinConns = c.MinConns
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create db pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return pool, nil
}
