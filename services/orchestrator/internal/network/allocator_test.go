package network

import (
	"net/netip"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewAllocator_ValidArgs(t *testing.T) {
	a, err := NewAllocator("10.10.0.0/16", 24, 30)
	require.NoError(t, err)
	require.NotNil(t, a)
}

func TestNewAllocator_InvalidArgs(t *testing.T) {
	_, err := NewAllocator("not-cidr", 24, 30)
	assert.Error(t, err)

	_, err = NewAllocator("10.10.0.0/16", 14, 30)
	assert.Error(t, err, "user size must be > base bits")

	_, err = NewAllocator("10.10.0.0/16", 24, 22)
	assert.Error(t, err, "instance size must be > user size")
}

func TestAllocate_FirstUser(t *testing.T) {
	a, _ := NewAllocator("10.10.0.0/16", 24, 30)

	userID := uuid.New()
	instanceID := uuid.New()

	res, err := a.Allocate(userID, instanceID)
	require.NoError(t, err)

	// First user gets first /24 = 10.10.0.0/24
	assert.Equal(t, "10.10.0.0/24", res.UserPrefix.String())

	// First /30 in user prefix is slot=1 (slot 0 is reserved) = 10.10.0.4/30
	assert.Equal(t, "10.10.0.4/30", res.InstanceCIDR.String())
	assert.Equal(t, "10.10.0.5", res.GatewayIP.String())
	assert.Equal(t, "10.10.0.6", res.InstanceIP.String())
}

func TestAllocate_TwoUsersGetDifferentPrefixes(t *testing.T) {
	a, _ := NewAllocator("10.10.0.0/16", 24, 30)

	user1, inst1 := uuid.New(), uuid.New()
	user2, inst2 := uuid.New(), uuid.New()

	r1, err := a.Allocate(user1, inst1)
	require.NoError(t, err)

	r2, err := a.Allocate(user2, inst2)
	require.NoError(t, err)

	assert.Equal(t, "10.10.0.0/24", r1.UserPrefix.String())
	assert.Equal(t, "10.10.1.0/24", r2.UserPrefix.String())
}

func TestAllocate_SameUserGetsTwoInstancesInSamePrefix(t *testing.T) {
	a, _ := NewAllocator("10.10.0.0/16", 24, 30)

	user := uuid.New()
	r1, _ := a.Allocate(user, uuid.New())
	r2, err := a.Allocate(user, uuid.New())
	require.NoError(t, err)

	assert.Equal(t, r1.UserPrefix.String(), r2.UserPrefix.String())
	assert.NotEqual(t, r1.InstanceCIDR.String(), r2.InstanceCIDR.String())

	// Adjacent /30s
	assert.Equal(t, "10.10.0.4/30", r1.InstanceCIDR.String())
	assert.Equal(t, "10.10.0.8/30", r2.InstanceCIDR.String())
}

func TestRelease_FreesSlot(t *testing.T) {
	a, _ := NewAllocator("10.10.0.0/16", 24, 30)

	user := uuid.New()
	inst1 := uuid.New()

	r1, _ := a.Allocate(user, inst1)
	require.NoError(t, a.Release(inst1))

	// New allocation should reuse the freed slot
	r2, err := a.Allocate(user, uuid.New())
	require.NoError(t, err)
	assert.Equal(t, r1.InstanceCIDR.String(), r2.InstanceCIDR.String())
}

func TestSlotPrefix(t *testing.T) {
	base := netip.MustParsePrefix("10.10.0.0/16")
	for i := 0; i < 5; i++ {
		p, err := slotPrefix(base, 24, i)
		require.NoError(t, err)
		expected := netip.MustParsePrefix("10.10." + itoa(i) + ".0/24").String()
		assert.Equal(t, expected, p.String())
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [10]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
