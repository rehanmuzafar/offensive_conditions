// Package service contains the orchestrator's business logic.
// Handlers are thin wrappers around these methods.
package service

import (
	"context"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/orchestrator/internal/backends"
	"github.com/offensive-conditions/orchestrator/internal/config"
	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
	"github.com/offensive-conditions/orchestrator/internal/events"
	"github.com/offensive-conditions/orchestrator/internal/flag"
	"github.com/offensive-conditions/orchestrator/internal/network"
	"github.com/offensive-conditions/orchestrator/internal/repository"
	"github.com/offensive-conditions/orchestrator/internal/scheduler"
)

// Orchestrator is the primary application service.
type Orchestrator struct {
	cfg            *config.Config
	log            zerolog.Logger
	machines       repository.MachineRepository
	instances      repository.InstanceRepository
	flagSubs       repository.FlagSubmissionRepository
	subnets        repository.SubnetAllocationRepository
	capacity       repository.CapacityRepository
	scheduler      *scheduler.Scheduler
	netAllocator   *network.Allocator
	vpn            *network.VPNController
	flagGen        *flag.Generator
	events         EventPublisher
	k8sBackend     backends.Backend
	proxmoxBackend backends.Backend
}

// EventPublisher allows tests to inject a mock publisher.
type EventPublisher interface {
	InstanceSpawned(ctx context.Context, userID, instanceID, machineID uuid.UUID, backend, requestID string)
	InstanceRunning(ctx context.Context, userID, instanceID, machineID uuid.UUID, ip string)
	InstanceTerminated(ctx context.Context, userID, instanceID, machineID uuid.UUID, reason string)
	InstanceExpired(ctx context.Context, userID, instanceID, machineID uuid.UUID)
	FlagSubmitted(ctx context.Context, userID, machineID uuid.UUID, instanceID *uuid.UUID, flagType string, correct bool)
	Publish(ctx context.Context, evt events.Event)
}

type Deps struct {
	Cfg            *config.Config
	Log            zerolog.Logger
	Machines       repository.MachineRepository
	Instances      repository.InstanceRepository
	FlagSubs       repository.FlagSubmissionRepository
	Subnets        repository.SubnetAllocationRepository
	Capacity       repository.CapacityRepository
	Scheduler      *scheduler.Scheduler
	NetAllocator   *network.Allocator
	VPN            *network.VPNController
	FlagGen        *flag.Generator
	Events         EventPublisher
	K8sBackend     backends.Backend
	ProxmoxBackend backends.Backend
}

func New(d Deps) *Orchestrator {
	return &Orchestrator{
		cfg: d.Cfg, log: d.Log,
		machines: d.Machines, instances: d.Instances, flagSubs: d.FlagSubs,
		subnets: d.Subnets, capacity: d.Capacity,
		scheduler: d.Scheduler, netAllocator: d.NetAllocator, vpn: d.VPN,
		flagGen: d.FlagGen, events: d.Events,
		k8sBackend: d.K8sBackend, proxmoxBackend: d.ProxmoxBackend,
	}
}

// RequestMeta carries per-request context.
type RequestMeta struct {
	UserID    uuid.UUID
	UserTier  string
	IP        netip.Addr
	UserAgent string
	RequestID string
}

// =============================================================================
// Spawn
// =============================================================================

type SpawnInput struct {
	MachineSlug string
	TTL         time.Duration
}

type SpawnOutput struct {
	InstanceID uuid.UUID
	State      repository.InstanceState
	ExpiresAt  time.Time
	// Connection info populated as the instance progresses
	IPAddress  string
	Subnet     string
}

// Spawn creates a new lab instance.
// Returns immediately with state=pending; the actual provisioning is async.
// Clients poll Get for status updates.
func (o *Orchestrator) Spawn(ctx context.Context, in SpawnInput, m RequestMeta) (*SpawnOutput, error) {
	// 1. Lookup machine
	machine, err := o.machines.GetBySlug(ctx, in.MachineSlug)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeMachineNotFound, "machine not found")
	}

	// 2. Permission check
	perm, err := o.scheduler.Check(ctx, m.UserID, m.UserTier, machine)
	if err != nil {
		return nil, err
	}
	if !perm.Allowed {
		return nil, perm.DenyReason
	}

	// 3. Determine TTL
	ttl := in.TTL
	if ttl == 0 {
		ttl = machine.DefaultTTL
		if ttl == 0 {
			ttl = o.cfg.Lifecycle.DefaultTTL
		}
	}
	if ttl > o.cfg.Lifecycle.MaxTTL {
		ttl = o.cfg.Lifecycle.MaxTTL
	}

	// 4. Generate instance row first (so we have an ID for flag generation)
	instanceID := uuid.New()
	expiresAt := time.Now().Add(ttl)

	// 5. Generate flag(s)
	flagUserRaw, flagUserHash := o.flagGen.Generate(m.UserID, machine.ID, instanceID, "user")
	flagRootRaw, flagRootHash := "", ""
	if machine.HasRootFlag {
		flagRootRaw, flagRootHash = o.flagGen.Generate(m.UserID, machine.ID, instanceID, "root")
	}

	inst := &repository.LabInstance{
		ID:           instanceID,
		UserID:       m.UserID,
		MachineID:    machine.ID,
		MachineSlug:  machine.Slug,
		Backend:      machine.Backend,
		State:        repository.StatePending,
		FlagUserHash: flagUserHash,
		FlagRootHash: flagRootHash,
		ExpiresAt:    expiresAt,
		RequestID:    m.RequestID,
	}
	if err := o.instances.Create(ctx, inst); err != nil {
		return nil, autherrors.Internal(err)
	}

	// 6. Allocate network
	netResult, err := o.netAllocator.Allocate(m.UserID, instanceID)
	if err != nil {
		_ = o.instances.UpdateFailure(ctx, instanceID, "network allocation failed: "+err.Error())
		return nil, autherrors.New(autherrors.CodeNetworkAllocFailed, err.Error())
	}
	if err := o.subnets.Allocate(ctx, &repository.SubnetAllocation{
		UserID: m.UserID, InstanceID: &instanceID, CIDR: netResult.InstanceCIDR.String(),
	}); err != nil {
		o.log.Warn().Err(err).Msg("subnet allocation persistence failed")
	}
	_ = o.instances.UpdateIP(ctx, instanceID,
		netResult.InstanceIP.String(), netResult.InstanceCIDR.String(), 0)

	// 7. Transition to spawning, dispatch to backend (async)
	_ = o.instances.UpdateState(ctx, instanceID, repository.StateSpawning, repository.StatePending)

	o.events.InstanceSpawned(ctx, m.UserID, instanceID, machine.ID, string(machine.Backend), m.RequestID)

	go o.dispatchSpawn(machine, inst, netResult, flagUserRaw, flagRootRaw, ttl)

	return &SpawnOutput{
		InstanceID: instanceID,
		State:      repository.StateSpawning,
		ExpiresAt:  expiresAt,
		IPAddress:  netResult.InstanceIP.String(),
		Subnet:     netResult.InstanceCIDR.String(),
	}, nil
}

// dispatchSpawn runs the actual backend provisioning in a goroutine.
// On failure, marks the instance as failed; on success, transitions to running
// once the backend reports ready.
func (o *Orchestrator) dispatchSpawn(
	machine *repository.Machine,
	inst *repository.LabInstance,
	netResult *network.AllocationResult,
	flagUser, flagRoot string,
	ttl time.Duration,
) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	be := o.backendFor(machine.Backend)
	if be == nil {
		_ = o.instances.UpdateFailure(ctx, inst.ID, "no backend available for "+string(machine.Backend))
		return
	}

	envVars := map[string]string{
		"FLAG_USER":   flagUser,
		"INSTANCE_ID": inst.ID.String(),
	}
	if flagRoot != "" {
		envVars["FLAG_ROOT"] = flagRoot
	}

	spawnReq := backends.SpawnRequest{
		InstanceID:   inst.ID,
		UserID:       inst.UserID,
		MachineSlug:  machine.Slug,
		Image:        machine.Image,
		CPURequest:   machine.CPURequest,
		MemRequest:   machine.MemRequest,
		CPULimit:     machine.CPULimit,
		MemLimit:     machine.MemLimit,
		Ports:        machine.Ports,
		EnvVars:      envVars,
		NetworkCIDR:  netResult.InstanceCIDR.String(),
		GatewayIP:    netResult.GatewayIP.String(),
		InstanceIP:   netResult.InstanceIP.String(),
		TTL:          ttl,
		RuntimeClass: o.cfg.K8s.RuntimeClass,
	}

	res, err := be.Spawn(ctx, spawnReq)
	if err != nil {
		o.log.Error().Err(err).Str("instance_id", inst.ID.String()).Msg("backend spawn failed")
		_ = o.instances.UpdateFailure(ctx, inst.ID, err.Error())
		_ = o.netAllocator.Release(inst.ID)
		_ = o.subnets.Release(ctx, inst.ID)
		return
	}

	_ = o.instances.UpdateBackendRef(ctx, inst.ID, res.Ref, res.NodeName)

	// VPN route programming (best-effort; logs failure but doesn't fail spawn)
	if err := o.vpn.AddRoute(ctx, inst.UserID.String(), inst.ID.String(),
		netResult.InstanceCIDR.String()); err != nil {
		o.log.Warn().Err(err).Msg("vpn route add failed")
	}

	// Poll backend until ready (or timeout)
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		st, err := be.Status(ctx, res.Ref)
		if err != nil {
			o.log.Error().Err(err).Msg("status check failed")
			time.Sleep(5 * time.Second)
			continue
		}
		if st.Phase == backends.PhaseFailed {
			_ = o.instances.UpdateFailure(ctx, inst.ID, st.Reason)
			return
		}
		if st.Phase == backends.PhaseRunning && st.Ready {
			ipToReport := st.IPAddress
			if ipToReport == "" {
				ipToReport = netResult.InstanceIP.String()
			}
			_ = o.instances.MarkStarted(ctx, inst.ID,
				ipToReport, netResult.InstanceCIDR.String(), time.Now())
			o.events.InstanceRunning(ctx, inst.UserID, inst.ID, inst.MachineID, ipToReport)
			return
		}
		time.Sleep(3 * time.Second)
	}

	// Timed out waiting for ready
	_ = o.instances.UpdateFailure(ctx, inst.ID, "timeout waiting for backend ready")
}

// backendFor picks the right backend implementation.
func (o *Orchestrator) backendFor(b repository.MachineBackend) backends.Backend {
	switch b {
	case repository.BackendKubernetes:
		return o.k8sBackend
	case repository.BackendProxmox:
		return o.proxmoxBackend
	}
	return nil
}

// =============================================================================
// Get / List
// =============================================================================

func (o *Orchestrator) Get(ctx context.Context, instanceID uuid.UUID, m RequestMeta) (*repository.LabInstance, error) {
	inst, err := o.instances.GetByID(ctx, instanceID)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeInstanceNotFound, "instance not found")
	}
	if inst.UserID != m.UserID && !isAdmin(m.UserTier) {
		return nil, autherrors.New(autherrors.CodeForbidden, "not your instance")
	}
	return inst, nil
}

func (o *Orchestrator) ListActiveForUser(ctx context.Context, userID uuid.UUID) ([]*repository.LabInstance, error) {
	return o.instances.GetActiveByUser(ctx, userID)
}

// =============================================================================
// Terminate
// =============================================================================

func (o *Orchestrator) Terminate(ctx context.Context, instanceID uuid.UUID, m RequestMeta) error {
	inst, err := o.instances.GetByID(ctx, instanceID)
	if err != nil {
		return autherrors.New(autherrors.CodeInstanceNotFound, "instance not found")
	}
	if inst.UserID != m.UserID && !isAdmin(m.UserTier) {
		return autherrors.New(autherrors.CodeForbidden, "not your instance")
	}
	if inst.IsTerminal() {
		return autherrors.New(autherrors.CodeConflict, "instance already terminal")
	}

	if err := o.instances.UpdateState(ctx, inst.ID, repository.StateTerminating,
		repository.StatePending, repository.StateSpawning, repository.StateRunning); err != nil {
		return autherrors.Internal(err)
	}

	// Async teardown
	go o.dispatchTerminate(inst, "user requested")

	return nil
}

func (o *Orchestrator) dispatchTerminate(inst *repository.LabInstance, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	be := o.backendFor(inst.Backend)
	if be != nil && inst.BackendRef != "" {
		if err := be.Teardown(ctx, inst.BackendRef); err != nil {
			o.log.Error().Err(err).Str("instance_id", inst.ID.String()).Msg("backend teardown failed")
		}
	}

	// Cleanup VPN route
	_ = o.vpn.RemoveRoute(ctx, inst.ID.String())

	// Release network allocation
	_ = o.netAllocator.Release(inst.ID)
	_ = o.subnets.Release(ctx, inst.ID)

	_ = o.instances.MarkTerminated(ctx, inst.ID, time.Now())
	o.events.InstanceTerminated(ctx, inst.UserID, inst.ID, inst.MachineID, reason)
}

// =============================================================================
// Extend
// =============================================================================

func (o *Orchestrator) Extend(ctx context.Context, instanceID uuid.UUID, m RequestMeta) (time.Time, error) {
	inst, err := o.instances.GetByID(ctx, instanceID)
	if err != nil {
		return time.Time{}, autherrors.New(autherrors.CodeInstanceNotFound, "instance not found")
	}
	if inst.UserID != m.UserID {
		return time.Time{}, autherrors.New(autherrors.CodeForbidden, "not your instance")
	}
	if !inst.IsActive() {
		return time.Time{}, autherrors.New(autherrors.CodeInstanceNotReady, "instance not running")
	}
	if inst.ExtensionsUsed >= o.cfg.Lifecycle.MaxExtensions {
		return time.Time{}, autherrors.New(autherrors.CodeMaxExtensionsReached,
			fmt.Sprintf("max %d extensions allowed", o.cfg.Lifecycle.MaxExtensions))
	}

	newExpiresAt := inst.ExpiresAt.Add(o.cfg.Lifecycle.ExtendStep)
	createdMax := inst.CreatedAt.Add(o.cfg.Lifecycle.MaxTTL)
	if newExpiresAt.After(createdMax) {
		newExpiresAt = createdMax
	}

	if err := o.instances.UpdateExpiresAt(ctx, inst.ID, newExpiresAt, true); err != nil {
		return time.Time{}, autherrors.Internal(err)
	}
	return newExpiresAt, nil
}

// =============================================================================
// Reset
// =============================================================================

func (o *Orchestrator) Reset(ctx context.Context, instanceID uuid.UUID, m RequestMeta) error {
	inst, err := o.instances.GetByID(ctx, instanceID)
	if err != nil {
		return autherrors.New(autherrors.CodeInstanceNotFound, "instance not found")
	}
	if inst.UserID != m.UserID {
		return autherrors.New(autherrors.CodeForbidden, "not your instance")
	}
	if !inst.IsActive() {
		return autherrors.New(autherrors.CodeInstanceNotReady, "instance not running")
	}

	be := o.backendFor(inst.Backend)
	if be == nil {
		return autherrors.New(autherrors.CodeBackendFailure, "no backend")
	}

	if err := be.Reset(ctx, inst.BackendRef); err != nil {
		if _, ok := err.(backends.ErrNotSupported); ok {
			// For backends without snapshot support: teardown + respawn
			return autherrors.New(autherrors.CodeConflict,
				"reset not supported by this backend; please terminate and respawn")
		}
		return autherrors.BackendFailure(string(inst.Backend), err)
	}
	return nil
}

// =============================================================================
// Logs
// =============================================================================

func (o *Orchestrator) Logs(ctx context.Context, instanceID uuid.UUID, tailLines int, m RequestMeta) ([]string, error) {
	inst, err := o.instances.GetByID(ctx, instanceID)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeInstanceNotFound, "instance not found")
	}
	if inst.UserID != m.UserID && !isAdmin(m.UserTier) {
		return nil, autherrors.New(autherrors.CodeForbidden, "not your instance")
	}
	be := o.backendFor(inst.Backend)
	if be == nil || inst.BackendRef == "" {
		return nil, autherrors.New(autherrors.CodeInstanceNotReady, "instance not ready")
	}
	return be.Logs(ctx, inst.BackendRef, tailLines)
}

// =============================================================================
// Submit Flag
// =============================================================================

type FlagSubmitInput struct {
	MachineSlug string
	InstanceID  *uuid.UUID
	FlagType    string // "user" or "root"
	Flag        string
}

type FlagSubmitOutput struct {
	Correct        bool
	AlreadySolved  bool
	PointsAwarded  int
}

// SubmitFlag verifies a submitted flag against the user's instance hash.
//
// Note: scoring is delegated to the scoring service via Kafka event.
// This method only records the attempt + returns correctness.
func (o *Orchestrator) SubmitFlag(ctx context.Context, in FlagSubmitInput, m RequestMeta) (*FlagSubmitOutput, error) {
	machine, err := o.machines.GetBySlug(ctx, in.MachineSlug)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeMachineNotFound, "machine not found")
	}

	if !o.flagGen.IsWellFormed(in.Flag) {
		// Record incorrect attempt anyway
		_ = o.flagSubs.Record(ctx, &repository.FlagSubmission{
			UserID: m.UserID, InstanceID: in.InstanceID, MachineID: machine.ID,
			FlagType: in.FlagType, Submitted: in.Flag, Correct: false, IPAddress: m.IP,
		})
		o.events.FlagSubmitted(ctx, m.UserID, machine.ID, in.InstanceID, in.FlagType, false)
		return &FlagSubmitOutput{Correct: false}, nil
	}

	// Already solved check
	already, err := o.flagSubs.HasSolved(ctx, m.UserID, machine.ID, in.FlagType)
	if err == nil && already {
		return &FlagSubmitOutput{Correct: true, AlreadySolved: true}, nil
	}

	// Need the user's instance to fetch the correct hash
	var instance *repository.LabInstance
	if in.InstanceID != nil {
		instance, _ = o.instances.GetByID(ctx, *in.InstanceID)
	} else {
		instance, _ = o.instances.GetByUserAndMachine(ctx, m.UserID, machine.ID)
	}
	if instance == nil {
		return nil, autherrors.New(autherrors.CodeInstanceNotFound,
			"no active instance — spawn the machine first")
	}
	if instance.UserID != m.UserID {
		return nil, autherrors.New(autherrors.CodeForbidden, "not your instance")
	}

	var targetHash string
	switch in.FlagType {
	case "user":
		targetHash = instance.FlagUserHash
	case "root":
		targetHash = instance.FlagRootHash
	default:
		return nil, autherrors.New(autherrors.CodeBadRequest, "flag_type must be 'user' or 'root'")
	}
	if targetHash == "" {
		return nil, autherrors.New(autherrors.CodeBadRequest,
			"this machine has no "+in.FlagType+" flag")
	}

	correct := o.flagGen.Verify(in.Flag, targetHash)

	_ = o.flagSubs.Record(ctx, &repository.FlagSubmission{
		UserID: m.UserID, InstanceID: &instance.ID, MachineID: machine.ID,
		FlagType: in.FlagType, Submitted: in.Flag, Correct: correct, IPAddress: m.IP,
	})
	o.events.FlagSubmitted(ctx, m.UserID, machine.ID, &instance.ID, in.FlagType, correct)

	return &FlagSubmitOutput{Correct: correct}, nil
}

// =============================================================================
// Admin: Capacity
// =============================================================================

func (o *Orchestrator) GetCapacity(ctx context.Context) ([]*repository.CapacitySnapshot, error) {
	return o.capacity.List(ctx)
}

func isAdmin(tier string) bool {
	// We treat any user with role "admin" as having elevated tier.
	// In handlers this is checked separately via JWT roles; this is a fallback.
	return false
}
