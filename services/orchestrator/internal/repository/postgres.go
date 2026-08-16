package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// Machine repo (read-only)
// =============================================================================

type pgMachineRepo struct{ pool *pgxpool.Pool }

func NewPGMachineRepo(pool *pgxpool.Pool) MachineRepository {
	return &pgMachineRepo{pool: pool}
}

const colsMachine = `id, slug, name, os_type, backend, difficulty, tier_required,
	image, cpu_request, mem_request, cpu_limit, mem_limit, ports, has_flag, has_root_flag,
	flag_schema, default_ttl_seconds, status, metadata, created_at, updated_at`

func scanMachine(row pgx.Row) (*Machine, error) {
	m := &Machine{}
	var (
		ports         []int32
		ttlSecs       int
		metadataRaw   []byte
	)
	err := row.Scan(
		&m.ID, &m.Slug, &m.Name, &m.OSType, &m.Backend, &m.Difficulty, &m.TierRequired,
		&m.Image, &m.CPURequest, &m.MemRequest, &m.CPULimit, &m.MemLimit, &ports,
		&m.HasFlag, &m.HasRootFlag, &m.FlagSchema, &ttlSecs, &m.Status,
		&metadataRaw, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan machine: %w", err)
	}
	for _, p := range ports {
		m.Ports = append(m.Ports, int(p))
	}
	m.DefaultTTL = time.Duration(ttlSecs) * time.Second
	if len(metadataRaw) > 0 {
		_ = json.Unmarshal(metadataRaw, &m.Metadata)
	}
	return m, nil
}

func (r *pgMachineRepo) GetByID(ctx context.Context, id uuid.UUID) (*Machine, error) {
	const q = `SELECT ` + colsMachine + ` FROM lab.machines WHERE id = $1`
	return scanMachine(r.pool.QueryRow(ctx, q, id))
}

func (r *pgMachineRepo) GetBySlug(ctx context.Context, slug string) (*Machine, error) {
	const q = `SELECT ` + colsMachine + ` FROM lab.machines WHERE slug = $1`
	return scanMachine(r.pool.QueryRow(ctx, q, slug))
}

// =============================================================================
// Instance repo
// =============================================================================

type pgInstanceRepo struct{ pool *pgxpool.Pool }

func NewPGInstanceRepo(pool *pgxpool.Pool) InstanceRepository {
	return &pgInstanceRepo{pool: pool}
}

const colsInstance = `id, user_id, machine_id, machine_slug, backend, state,
	backend_ref, backend_node, ip_address, subnet, vlan_tag, flag_user_hash, flag_root_hash,
	started_at, expires_at, terminated_at, extensions_used, last_healthy_at, health_status,
	failure_reason, request_id, created_at, updated_at`

func scanInstance(row pgx.Row) (*LabInstance, error) {
	i := &LabInstance{}
	var (
		backendRef    *string
		backendNode   *string
		ipStr         *string
		subnet        *string
		vlanTag       *int
		startedAt     *time.Time
		terminatedAt  *time.Time
		lastHealthy   *time.Time
		healthStatus  *string
		failure       *string
		requestID     *string
	)
	err := row.Scan(
		&i.ID, &i.UserID, &i.MachineID, &i.MachineSlug, &i.Backend, &i.State,
		&backendRef, &backendNode, &ipStr, &subnet, &vlanTag, &i.FlagUserHash, &i.FlagRootHash,
		&startedAt, &i.ExpiresAt, &terminatedAt, &i.ExtensionsUsed, &lastHealthy, &healthStatus,
		&failure, &requestID, &i.CreatedAt, &i.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan instance: %w", err)
	}
	if backendRef != nil {
		i.BackendRef = *backendRef
	}
	if backendNode != nil {
		i.BackendNode = *backendNode
	}
	if ipStr != nil {
		addr, _ := netip.ParseAddr(*ipStr)
		i.IPAddress = &addr
	}
	if subnet != nil {
		i.Subnet = *subnet
	}
	if vlanTag != nil {
		i.VLANTag = *vlanTag
	}
	i.StartedAt = startedAt
	i.TerminatedAt = terminatedAt
	i.LastHealthyAt = lastHealthy
	if healthStatus != nil {
		i.HealthStatus = *healthStatus
	}
	if failure != nil {
		i.FailureReason = *failure
	}
	if requestID != nil {
		i.RequestID = *requestID
	}
	return i, nil
}

func (r *pgInstanceRepo) Create(ctx context.Context, in *LabInstance) error {
	const q = `
		INSERT INTO lab.instances
			(id, user_id, machine_id, machine_slug, backend, state, flag_user_hash, flag_root_hash,
			 expires_at, request_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''))`
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	if in.State == "" {
		in.State = StatePending
	}
	_, err := r.pool.Exec(ctx, q,
		in.ID, in.UserID, in.MachineID, in.MachineSlug, in.Backend, in.State,
		in.FlagUserHash, in.FlagRootHash, in.ExpiresAt, in.RequestID,
	)
	return err
}

func (r *pgInstanceRepo) GetByID(ctx context.Context, id uuid.UUID) (*LabInstance, error) {
	const q = `SELECT ` + colsInstance + ` FROM lab.instances WHERE id = $1`
	return scanInstance(r.pool.QueryRow(ctx, q, id))
}

func (r *pgInstanceRepo) GetActiveByUser(ctx context.Context, userID uuid.UUID) ([]*LabInstance, error) {
	const q = `
		SELECT ` + colsInstance + `
		FROM lab.instances
		WHERE user_id = $1 AND state IN ('pending','spawning','running')
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*LabInstance
	for rows.Next() {
		in, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}

func (r *pgInstanceRepo) GetByUserAndMachine(ctx context.Context, userID, machineID uuid.UUID) (*LabInstance, error) {
	const q = `
		SELECT ` + colsInstance + `
		FROM lab.instances
		WHERE user_id = $1 AND machine_id = $2 AND state IN ('pending','spawning','running')
		ORDER BY created_at DESC LIMIT 1`
	return scanInstance(r.pool.QueryRow(ctx, q, userID, machineID))
}

func (r *pgInstanceRepo) ListExpired(ctx context.Context, limit int) ([]*LabInstance, error) {
	const q = `
		SELECT ` + colsInstance + `
		FROM lab.instances
		WHERE state IN ('pending','spawning','running')
		  AND expires_at < NOW()
		ORDER BY expires_at
		LIMIT $1`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*LabInstance
	for rows.Next() {
		in, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}

func (r *pgInstanceRepo) ListByState(ctx context.Context, state InstanceState, limit int) ([]*LabInstance, error) {
	const q = `SELECT ` + colsInstance + ` FROM lab.instances WHERE state = $1 ORDER BY created_at LIMIT $2`
	rows, err := r.pool.Query(ctx, q, state, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*LabInstance
	for rows.Next() {
		in, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}

// UpdateState transitions the state; if allowedFrom is provided, only updates if current
// state is in that set (optimistic concurrency).
func (r *pgInstanceRepo) UpdateState(ctx context.Context, id uuid.UUID, newState InstanceState, allowedFrom ...InstanceState) error {
	if len(allowedFrom) == 0 {
		const q = `UPDATE lab.instances SET state = $2, updated_at = NOW() WHERE id = $1`
		tag, err := r.pool.Exec(ctx, q, id, newState)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	}

	states := make([]string, len(allowedFrom))
	for i, s := range allowedFrom {
		states[i] = string(s)
	}
	const q = `
		UPDATE lab.instances
		SET state = $2, updated_at = NOW()
		WHERE id = $1 AND state = ANY($3::text[])`
	tag, err := r.pool.Exec(ctx, q, id, newState, states)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: state transition not allowed", ErrConflict)
	}
	return nil
}

func (r *pgInstanceRepo) UpdateBackendRef(ctx context.Context, id uuid.UUID, backendRef, backendNode string) error {
	const q = `UPDATE lab.instances SET backend_ref = $2, backend_node = NULLIF($3, ''), updated_at = NOW() WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, backendRef, backendNode)
	return err
}

func (r *pgInstanceRepo) UpdateIP(ctx context.Context, id uuid.UUID, ip, subnet string, vlanTag int) error {
	const q = `
		UPDATE lab.instances
		SET ip_address = NULLIF($2, '')::inet,
		    subnet = NULLIF($3, ''),
		    vlan_tag = NULLIF($4, 0),
		    updated_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, ip, subnet, vlanTag)
	return err
}

func (r *pgInstanceRepo) UpdateExpiresAt(ctx context.Context, id uuid.UUID, expiresAt time.Time, incrementExt bool) error {
	if incrementExt {
		const q = `UPDATE lab.instances SET expires_at = $2, extensions_used = extensions_used + 1, updated_at = NOW() WHERE id = $1`
		_, err := r.pool.Exec(ctx, q, id, expiresAt)
		return err
	}
	const q = `UPDATE lab.instances SET expires_at = $2, updated_at = NOW() WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, expiresAt)
	return err
}

func (r *pgInstanceRepo) UpdateHealth(ctx context.Context, id uuid.UUID, status string) error {
	const q = `
		UPDATE lab.instances
		SET health_status = $2,
		    last_healthy_at = CASE WHEN $2 = 'ok' THEN NOW() ELSE last_healthy_at END,
		    updated_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, status)
	return err
}

func (r *pgInstanceRepo) UpdateFailure(ctx context.Context, id uuid.UUID, reason string) error {
	const q = `
		UPDATE lab.instances
		SET state = 'failed', failure_reason = $2, updated_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, reason)
	return err
}

func (r *pgInstanceRepo) MarkStarted(ctx context.Context, id uuid.UUID, ip, subnet string, startedAt time.Time) error {
	const q = `
		UPDATE lab.instances
		SET state = 'running',
		    ip_address = NULLIF($2, '')::inet,
		    subnet = NULLIF($3, ''),
		    started_at = $4,
		    health_status = 'ok',
		    last_healthy_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, ip, subnet, startedAt)
	return err
}

func (r *pgInstanceRepo) MarkTerminated(ctx context.Context, id uuid.UUID, when time.Time) error {
	const q = `
		UPDATE lab.instances
		SET state = 'terminated', terminated_at = $2, updated_at = NOW()
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, when)
	return err
}

func (r *pgInstanceRepo) CountActiveByUser(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT COUNT(*) FROM lab.instances WHERE user_id = $1 AND state IN ('pending','spawning','running')`
	var n int
	err := r.pool.QueryRow(ctx, q, userID).Scan(&n)
	return n, err
}

func (r *pgInstanceRepo) SumActiveHoursThisMonth(ctx context.Context, userID uuid.UUID) (float64, error) {
	const q = `
		SELECT COALESCE(SUM(
			EXTRACT(EPOCH FROM (
				COALESCE(terminated_at, NOW()) - COALESCE(started_at, created_at)
			)) / 3600
		), 0)
		FROM lab.instances
		WHERE user_id = $1
		  AND COALESCE(started_at, created_at) >= date_trunc('month', NOW())`
	var hours float64
	err := r.pool.QueryRow(ctx, q, userID).Scan(&hours)
	return hours, err
}

// =============================================================================
// Flag submission repo
// =============================================================================

type pgFlagSubmissionRepo struct{ pool *pgxpool.Pool }

func NewPGFlagSubmissionRepo(pool *pgxpool.Pool) FlagSubmissionRepository {
	return &pgFlagSubmissionRepo{pool: pool}
}

func (r *pgFlagSubmissionRepo) Record(ctx context.Context, s *FlagSubmission) error {
	const q = `
		INSERT INTO lab.flag_submissions
			(user_id, instance_id, machine_id, flag_type, submitted, correct, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`
	ip := s.IPAddress.String()
	if !s.IPAddress.IsValid() {
		ip = "127.0.0.1"
	}
	_, err := r.pool.Exec(ctx, q, s.UserID, s.InstanceID, s.MachineID, s.FlagType, s.Submitted, s.Correct, ip)
	return err
}

func (r *pgFlagSubmissionRepo) HasSolved(ctx context.Context, userID, machineID uuid.UUID, flagType string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM lab.flag_submissions
			WHERE user_id = $1 AND machine_id = $2 AND flag_type = $3 AND correct = TRUE
		)`
	var exists bool
	err := r.pool.QueryRow(ctx, q, userID, machineID, flagType).Scan(&exists)
	return exists, err
}

// =============================================================================
// Subnet allocation repo
// =============================================================================

type pgSubnetRepo struct{ pool *pgxpool.Pool }

func NewPGSubnetAllocationRepo(pool *pgxpool.Pool) SubnetAllocationRepository {
	return &pgSubnetRepo{pool: pool}
}

func (r *pgSubnetRepo) Allocate(ctx context.Context, a *SubnetAllocation) error {
	const q = `
		INSERT INTO lab.subnet_allocations (id, user_id, instance_id, cidr, state)
		VALUES ($1, $2, $3, $4, 'allocated')`
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	_, err := r.pool.Exec(ctx, q, a.ID, a.UserID, a.InstanceID, a.CIDR)
	return err
}

func (r *pgSubnetRepo) Release(ctx context.Context, instanceID uuid.UUID) error {
	const q = `
		UPDATE lab.subnet_allocations
		SET state = 'released', released_at = NOW()
		WHERE instance_id = $1 AND state = 'allocated'`
	_, err := r.pool.Exec(ctx, q, instanceID)
	return err
}

func (r *pgSubnetRepo) ListAllocatedCIDRs(ctx context.Context) ([]string, error) {
	const q = `SELECT cidr FROM lab.subnet_allocations WHERE state = 'allocated'`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *pgSubnetRepo) GetByInstance(ctx context.Context, instanceID uuid.UUID) (*SubnetAllocation, error) {
	const q = `
		SELECT id, user_id, instance_id, cidr, state, allocated_at, released_at
		FROM lab.subnet_allocations
		WHERE instance_id = $1 AND state = 'allocated'`
	a := &SubnetAllocation{}
	var releasedAt *time.Time
	err := r.pool.QueryRow(ctx, q, instanceID).Scan(
		&a.ID, &a.UserID, &a.InstanceID, &a.CIDR, &a.State, &a.AllocatedAt, &releasedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.ReleasedAt = releasedAt
	return a, nil
}

// =============================================================================
// Capacity repo
// =============================================================================

type pgCapacityRepo struct{ pool *pgxpool.Pool }

func NewPGCapacityRepo(pool *pgxpool.Pool) CapacityRepository {
	return &pgCapacityRepo{pool: pool}
}

func (r *pgCapacityRepo) Upsert(ctx context.Context, s *CapacitySnapshot) error {
	const q = `
		INSERT INTO lab.capacity_snapshots
			(backend, node, total_cpu_millis, used_cpu_millis, total_mem_mb, used_mem_mb,
			 instances_running, instances_max, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (backend, node) DO UPDATE SET
			total_cpu_millis = EXCLUDED.total_cpu_millis,
			used_cpu_millis = EXCLUDED.used_cpu_millis,
			total_mem_mb = EXCLUDED.total_mem_mb,
			used_mem_mb = EXCLUDED.used_mem_mb,
			instances_running = EXCLUDED.instances_running,
			instances_max = EXCLUDED.instances_max,
			updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q,
		s.Backend, s.Node, s.TotalCPUMillis, s.UsedCPUMillis,
		s.TotalMemMB, s.UsedMemMB, s.InstancesRunning, s.InstancesMax,
	)
	return err
}

func (r *pgCapacityRepo) List(ctx context.Context) ([]*CapacitySnapshot, error) {
	const q = `
		SELECT backend, node, total_cpu_millis, used_cpu_millis, total_mem_mb, used_mem_mb,
		       instances_running, instances_max, updated_at
		FROM lab.capacity_snapshots
		ORDER BY backend, node`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*CapacitySnapshot
	for rows.Next() {
		s := &CapacitySnapshot{}
		err := rows.Scan(
			&s.Backend, &s.Node, &s.TotalCPUMillis, &s.UsedCPUMillis,
			&s.TotalMemMB, &s.UsedMemMB, &s.InstancesRunning, &s.InstancesMax, &s.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// =============================================================================
// Pool helper
// =============================================================================

type PoolConfig struct {
	DSN      string
	MaxConns int32
	MinConns int32
}

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
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}
