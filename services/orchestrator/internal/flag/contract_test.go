package flag

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Contract vectors for the platform flag format.
//
// This service mints flags and flag-verifier verifies them, but they are
// separate Go modules with separate Docker build contexts, so they cannot
// share the implementation. They share these vectors instead:
// `flag-verifier/internal/hmac/contract_test.go` asserts the same constants
// against its own code. If the two implementations ever drift, one side's
// vectors fail.
//
// Do not "fix" a failing vector by editing the expected string. A changed
// vector means the wire format changed, and every flag already minted under
// the old one stops verifying.

const (
	ctSecret    = "offcon-contract-test-secret"
	ctContentID = "11111111-1111-4111-8111-111111111111"
	ctUserID    = "22222222-2222-4222-8222-222222222222"
	ctInstance  = "33333333-3333-4333-8333-333333333333"
	ctSlug      = "jeeves"

	ctFlagUser      = "OFFCON{jeeves_user_222222_7ef023bba2f1148844db04de741c245f}"
	ctFlagRoot      = "OFFCON{jeeves_root_222222_013c93474470ec5a29468f80667b01fd}"
	ctFlagChallenge = "OFFCON{jeeves_challenge_222222_eebae1c0aaf2d6d14ed7cade2ebbd3a1}"
	ctFlagNilInst   = "OFFCON{jeeves_challenge_222222_0c00ca08790a78e05112e563efa32f5b}"
)

func ctIDs(t *testing.T) (content, user, instance uuid.UUID) {
	t.Helper()
	return uuid.MustParse(ctContentID), uuid.MustParse(ctUserID), uuid.MustParse(ctInstance)
}

func TestContract_GeneratedFlagsAreStable(t *testing.T) {
	content, user, instance := ctIDs(t)
	g := NewGenerator([]byte(ctSecret), "OFFCON")

	for _, tc := range []struct{ flagType, want string }{
		{FlagTypeUser, ctFlagUser},
		{FlagTypeRoot, ctFlagRoot},
		{FlagTypeChallenge, ctFlagChallenge},
	} {
		t.Run(tc.flagType, func(t *testing.T) {
			raw, hash := g.Generate(content, user, instance, ctSlug, tc.flagType)
			assert.Equal(t, tc.want, raw,
				"wire format changed — flag-verifier will not verify this")
			assert.Len(t, hash, 64, "storage hash is SHA-256 hex")
			assert.True(t, g.Verify(raw, hash))
		})
	}
}

func TestContract_NilInstanceForStaticContent(t *testing.T) {
	content, user, _ := ctIDs(t)
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	raw, _ := g.Generate(content, user, uuid.Nil, ctSlug, FlagTypeChallenge)
	assert.Equal(t, ctFlagNilInst, raw)
}

// The reason the flag type is inside the signed message: without it, the user
// flag and the root flag for one instance are the same string, and rooting the
// box is not required to submit the root flag.
func TestContract_UserAndRootDifferForSameInstance(t *testing.T) {
	content, user, instance := ctIDs(t)
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	userRaw, userHash := g.Generate(content, user, instance, ctSlug, FlagTypeUser)
	rootRaw, rootHash := g.Generate(content, user, instance, ctSlug, FlagTypeRoot)

	assert.NotEqual(t, userRaw, rootRaw, "flag type is not bound into the HMAC")
	assert.NotEqual(t, userHash, rootHash)
	assert.False(t, g.Verify(userRaw, rootHash), "a user flag must not satisfy the root hash")
}

// Each spawn must invalidate the last one's flags.
func TestContract_InstanceIDChangesTheFlag(t *testing.T) {
	content, user, instance := ctIDs(t)
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	a, _ := g.Generate(content, user, instance, ctSlug, FlagTypeUser)
	b, _ := g.Generate(content, user, uuid.New(), ctSlug, FlagTypeUser)
	assert.NotEqual(t, a, b)
}

// Two users on the same box get different flags — this is what stops sharing.
func TestContract_DifferentUsersGetDifferentFlags(t *testing.T) {
	content, user, instance := ctIDs(t)
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	a, _ := g.Generate(content, user, instance, ctSlug, FlagTypeUser)
	b, _ := g.Generate(content, uuid.New(), instance, ctSlug, FlagTypeUser)
	assert.NotEqual(t, a, b)
}

func TestContract_ParseRoundTrip(t *testing.T) {
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	for _, tc := range []struct{ raw, flagType string }{
		{ctFlagUser, FlagTypeUser},
		{ctFlagRoot, FlagTypeRoot},
		{ctFlagChallenge, FlagTypeChallenge},
	} {
		t.Run(tc.flagType, func(t *testing.T) {
			parsed, err := g.Parse(tc.raw)
			require.NoError(t, err)
			assert.Equal(t, ctSlug, parsed.Slug)
			assert.Equal(t, tc.flagType, parsed.FlagType)
			assert.Equal(t, "222222", parsed.UserShort)
			assert.True(t, g.IsWellFormed(tc.raw))
		})
	}
}

func TestContract_MultiWordSlugParsesFromTheRight(t *testing.T) {
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	parsed, err := g.Parse("OFFCON{multi_word_slug_root_222222_013c93474470ec5a29468f80667b01fd}")
	require.NoError(t, err)
	assert.Equal(t, "multi_word_slug", parsed.Slug)
	assert.Equal(t, FlagTypeRoot, parsed.FlagType)
}

func TestContract_MalformedFlagsRejected(t *testing.T) {
	g := NewGenerator([]byte(ctSecret), "OFFCON")
	for name, raw := range map[string]string{
		"wrong prefix":   "HTB{jeeves_user_222222_7ef023bba2f1148844db04de741c245f}",
		"no braces":      "OFFCON jeeves_user_222222_7ef023bba2f1148844db04de741c245f",
		"missing type":   "OFFCON{jeeves_222222_7ef023bba2f1148844db04de741c245f}",
		"unknown type":   "OFFCON{jeeves_admin_222222_7ef023bba2f1148844db04de741c245f}",
		"short hmac":     "OFFCON{jeeves_user_222222_7ef023bb}",
		"non-hex hmac":   "OFFCON{jeeves_user_222222_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz}",
		"bad user short": "OFFCON{jeeves_user_zzzzzz_7ef023bba2f1148844db04de741c245f}",
		"empty slug":     "OFFCON{_user_222222_7ef023bba2f1148844db04de741c245f}",
		"empty":          "",
	} {
		t.Run(name, func(t *testing.T) {
			assert.False(t, g.IsWellFormed(raw))
		})
	}
}
