// Package scheduler decides:
//   1. Is the user allowed to spawn this machine? (tier, quota)
//   2. Which backend should handle it? (k8s vs proxmox)
//   3. Is there capacity? (concurrent limit, monthly hours)
//
// It does NOT execute the spawn — it produces a plan that the service layer
// hands to the backend.
package scheduler

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/orchestrator/internal/config"
	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
	"github.com/offensive-conditions/orchestrator/internal/repository"
)

type Scheduler struct {
	cfg       *config.Config
	instances repository.InstanceRepository
	log       zerolog.Logger
}

func New(cfg *config.Config, instances repository.InstanceRepository, log zerolog.Logger) *Scheduler {
	return &Scheduler{cfg: cfg, instances: instances, log: log}
}

// SpawnPermission describes whether and how a user may spawn a machine.
type SpawnPermission struct {
	Allowed             bool
	Backend             repository.MachineBackend
	DenyReason          *autherrors.Error
	UserConcurrent      int
	UserConcurrentLimit int
	UserMonthlyHours    float64
	UserMonthlyLimit    int
}

// Check returns whether the user can spawn this machine, given their tier and current usage.
func (s *Scheduler) Check(ctx context.Context, userID uuid.UUID, userTier string, machine *repository.Machine) (*SpawnPermission, error) {
	perm := &SpawnPermission{
		Backend: machine.Backend,
	}

	// 1. Tier gate
	if !tierAllows(userTier, machine.TierRequired) {
		perm.DenyReason = autherrors.MachineRequiresTier(machine.TierRequired)
		return perm, nil
	}

	// 2. Machine availability
	if machine.Status != "active" {
		perm.DenyReason = autherrors.New(autherrors.CodeMachineNotAvailable,
			fmt.Sprintf("machine status: %s", machine.Status))
		return perm, nil
	}

	// 3. Concurrent instance limit
	concurrent, err := s.instances.CountActiveByUser(ctx, userID)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	perm.UserConcurrent = concurrent

	concurrentLimit := s.cfg.Quota.ConcurrentInstancesFree
	if isProTier(userTier) {
		concurrentLimit = s.cfg.Quota.ConcurrentInstancesPro
	}
	perm.UserConcurrentLimit = concurrentLimit

	if concurrent >= concurrentLimit {
		perm.DenyReason = autherrors.ConcurrentExceeded(concurrentLimit, userTier)
		return perm, nil
	}

	// 4. Monthly hours quota
	hours, err := s.instances.SumActiveHoursThisMonth(ctx, userID)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	perm.UserMonthlyHours = hours

	monthlyLimit := s.cfg.Quota.MonthlyHoursFree
	if isProTier(userTier) {
		monthlyLimit = s.cfg.Quota.MonthlyHoursPro
	}
	perm.UserMonthlyLimit = monthlyLimit

	if int(hours) >= monthlyLimit {
		perm.DenyReason = autherrors.QuotaExceeded(monthlyLimit, userTier)
		return perm, nil
	}

	// 5. Check if user already has an active instance of this machine
	if existing, err := s.instances.GetByUserAndMachine(ctx, userID, machine.ID); err == nil && existing != nil {
		perm.DenyReason = autherrors.New(autherrors.CodeConflict,
			"You already have an active instance of this machine").
			WithDetails(map[string]any{"instance_id": existing.ID.String()})
		return perm, nil
	}

	perm.Allowed = true
	return perm, nil
}

// tierAllows checks if user's tier satisfies the machine's required tier.
// Tier ordering: free < pro < enterprise.
func tierAllows(userTier, requiredTier string) bool {
	order := map[string]int{
		"free":       0,
		"pro":        1,
		"enterprise": 2,
	}
	uv, ok1 := order[userTier]
	rv, ok2 := order[requiredTier]
	if !ok1 {
		uv = 0
	}
	if !ok2 {
		rv = 0
	}
	return uv >= rv
}

func isProTier(tier string) bool {
	return tier == "pro" || tier == "enterprise"
}
