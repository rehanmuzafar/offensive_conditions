// Package network manages IP allocation, VLAN assignments, and VPN routing
// for lab instances. Each instance gets a /30 from its user's /24 pool.
package network

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"sync"

	"github.com/google/uuid"
)

// Allocator manages per-user subnet pools.
//
// Each user is given a /24 carved from a configured base (e.g. 10.10.0.0/16 → 256 users).
// Within that /24, /30 sub-allocations are made (62 usable per user; .0 is reserved
// for the user's VPN gateway address).
type Allocator struct {
	mu sync.Mutex

	basePrefix       netip.Prefix // e.g. 10.10.0.0/16
	userPrefixSize   int          // 24
	instancePrefixSize int        // 30

	// In-memory tracking. Production version backs this with PostgreSQL
	// (subnet_allocations table) for durability across restarts.
	userToPrefix    map[uuid.UUID]netip.Prefix         // user_id → /24
	instanceCIDRs   map[uuid.UUID]string               // instance_id → /30 CIDR
	usedUserSlots   map[int]uuid.UUID                  // slot # in base → user_id
	usedInstanceCIDRs map[string]uuid.UUID             // CIDR → instance_id
}

func NewAllocator(base string, userSize, instanceSize int) (*Allocator, error) {
	p, err := netip.ParsePrefix(base)
	if err != nil {
		return nil, fmt.Errorf("parse base prefix: %w", err)
	}
	if !p.Addr().Is4() {
		return nil, errors.New("only IPv4 supported")
	}
	if userSize <= p.Bits() || instanceSize <= userSize {
		return nil, fmt.Errorf("invalid prefix sizes: base=%d user=%d instance=%d",
			p.Bits(), userSize, instanceSize)
	}
	return &Allocator{
		basePrefix:        p,
		userPrefixSize:    userSize,
		instancePrefixSize: instanceSize,
		userToPrefix:      make(map[uuid.UUID]netip.Prefix),
		instanceCIDRs:     make(map[uuid.UUID]string),
		usedUserSlots:     make(map[int]uuid.UUID),
		usedInstanceCIDRs: make(map[string]uuid.UUID),
	}, nil
}

// Hydrate loads existing allocations from persistent storage at boot.
// CIDRs come from lab.subnet_allocations.
func (a *Allocator) Hydrate(ctx context.Context, existing []ExistingAllocation) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, e := range existing {
		p, err := netip.ParsePrefix(e.CIDR)
		if err != nil {
			continue
		}
		// Derive user /24 from instance /30
		userPrefix := containingPrefix(p.Addr(), a.userPrefixSize)
		a.userToPrefix[e.UserID] = userPrefix
		a.usedUserSlots[userSlotIndex(userPrefix, a.basePrefix)] = e.UserID
		if e.InstanceID != nil {
			a.instanceCIDRs[*e.InstanceID] = e.CIDR
			a.usedInstanceCIDRs[e.CIDR] = *e.InstanceID
		}
	}
	return nil
}

type ExistingAllocation struct {
	UserID     uuid.UUID
	InstanceID *uuid.UUID
	CIDR       string
}

// AllocationResult is what Allocate returns.
type AllocationResult struct {
	InstanceCIDR netip.Prefix // /30 for the instance
	GatewayIP    netip.Addr   // .1 of the /30 — host side of veth pair
	InstanceIP   netip.Addr   // .2 of the /30 — given to the lab instance
	UserPrefix   netip.Prefix // /24 the user owns
}

// Allocate finds an available /30 within the user's /24 and reserves it.
// Auto-allocates a /24 for the user on first call.
func (a *Allocator) Allocate(userID, instanceID uuid.UUID) (*AllocationResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Ensure user has a /24
	userPrefix, ok := a.userToPrefix[userID]
	if !ok {
		p, err := a.allocateUserPrefix(userID)
		if err != nil {
			return nil, err
		}
		userPrefix = p
	}

	// Find free /30 in user's /24
	instancePrefix, err := a.allocateInstancePrefix(userPrefix)
	if err != nil {
		return nil, err
	}

	cidr := instancePrefix.String()
	a.instanceCIDRs[instanceID] = cidr
	a.usedInstanceCIDRs[cidr] = instanceID

	// /30 has 4 IPs: .0=network, .1=gateway, .2=instance, .3=broadcast
	gateway := nextAddr(instancePrefix.Addr())
	instance := nextAddr(gateway)

	return &AllocationResult{
		InstanceCIDR: instancePrefix,
		GatewayIP:    gateway,
		InstanceIP:   instance,
		UserPrefix:   userPrefix,
	}, nil
}

// Release frees the /30 used by instanceID.
func (a *Allocator) Release(instanceID uuid.UUID) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	cidr, ok := a.instanceCIDRs[instanceID]
	if !ok {
		return errors.New("instance not allocated")
	}
	delete(a.instanceCIDRs, instanceID)
	delete(a.usedInstanceCIDRs, cidr)
	return nil
}

// CIDRForInstance returns the assigned /30 for an instance, if any.
func (a *Allocator) CIDRForInstance(instanceID uuid.UUID) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, ok := a.instanceCIDRs[instanceID]
	return c, ok
}

// allocateUserPrefix picks the first free /24 slot in the base /16.
// Caller must hold mu.
func (a *Allocator) allocateUserPrefix(userID uuid.UUID) (netip.Prefix, error) {
	slotBits := a.userPrefixSize - a.basePrefix.Bits() // bits identifying the slot
	maxSlots := 1 << slotBits
	for i := 0; i < maxSlots; i++ {
		if _, taken := a.usedUserSlots[i]; taken {
			continue
		}
		prefix, err := slotPrefix(a.basePrefix, a.userPrefixSize, i)
		if err != nil {
			continue
		}
		a.userToPrefix[userID] = prefix
		a.usedUserSlots[i] = userID
		return prefix, nil
	}
	return netip.Prefix{}, errors.New("no free user prefix available")
}

// allocateInstancePrefix picks the first free /30 within the user's /24.
// Skips slot 0 (reserved for user VPN gateway addr).
// Caller must hold mu.
func (a *Allocator) allocateInstancePrefix(userPrefix netip.Prefix) (netip.Prefix, error) {
	slotBits := a.instancePrefixSize - userPrefix.Bits()
	maxSlots := 1 << slotBits
	// Skip i=0 to keep .0 of the /24 available for user infrastructure
	for i := 1; i < maxSlots; i++ {
		prefix, err := slotPrefix(userPrefix, a.instancePrefixSize, i)
		if err != nil {
			continue
		}
		cidr := prefix.String()
		if _, taken := a.usedInstanceCIDRs[cidr]; taken {
			continue
		}
		return prefix, nil
	}
	return netip.Prefix{}, errors.New("user prefix exhausted")
}

// =============================================================================
// IP arithmetic helpers
// =============================================================================

// slotPrefix returns the n-th sub-prefix of size newBits within parent.
func slotPrefix(parent netip.Prefix, newBits, slot int) (netip.Prefix, error) {
	if newBits <= parent.Bits() {
		return netip.Prefix{}, errors.New("newBits must be > parent.Bits()")
	}
	a := parent.Addr().As4()
	base := (uint32(a[0]) << 24) | (uint32(a[1]) << 16) | (uint32(a[2]) << 8) | uint32(a[3])
	addrSlotSize := uint32(1) << (32 - newBits)
	newBase := base + uint32(slot)*addrSlotSize
	newAddr := netip.AddrFrom4([4]byte{
		byte(newBase >> 24), byte(newBase >> 16), byte(newBase >> 8), byte(newBase),
	})
	return netip.PrefixFrom(newAddr, newBits), nil
}

// containingPrefix returns the prefix of size `bits` that contains addr.
func containingPrefix(addr netip.Addr, bits int) netip.Prefix {
	if !addr.Is4() {
		return netip.Prefix{}
	}
	a := addr.As4()
	v := (uint32(a[0]) << 24) | (uint32(a[1]) << 16) | (uint32(a[2]) << 8) | uint32(a[3])
	mask := uint32(0xFFFFFFFF) << (32 - bits)
	v &= mask
	masked := netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})
	return netip.PrefixFrom(masked, bits)
}

// userSlotIndex returns which slot a userPrefix occupies within base.
func userSlotIndex(userPrefix, basePrefix netip.Prefix) int {
	a := userPrefix.Addr().As4()
	b := basePrefix.Addr().As4()
	aInt := (uint32(a[0]) << 24) | (uint32(a[1]) << 16) | (uint32(a[2]) << 8) | uint32(a[3])
	bInt := (uint32(b[0]) << 24) | (uint32(b[1]) << 16) | (uint32(b[2]) << 8) | uint32(b[3])
	diff := aInt - bInt
	slotSize := uint32(1) << (32 - userPrefix.Bits())
	return int(diff / slotSize)
}

func nextAddr(a netip.Addr) netip.Addr {
	b := a.As4()
	v := (uint32(b[0]) << 24) | (uint32(b[1]) << 16) | (uint32(b[2]) << 8) | uint32(b[3])
	v++
	return netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})
}
