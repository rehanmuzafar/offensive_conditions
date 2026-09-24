package hmac

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Contract vectors for the platform flag format.
//
// The orchestrator mints flags and this service verifies them, but they are
// separate Go modules with separate Docker build contexts, so they cannot
// share the implementation. They share these vectors instead:
// `orchestrator/internal/flag/contract_test.go` asserts the same constants
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

func TestContract_FlagStringsAreStable(t *testing.T) {
	content, user, instance := ctIDs(t)
	secret := []byte(ctSecret)

	for _, tc := range []struct {
		flagType string
		want     string
	}{
		{FlagTypeUser, ctFlagUser},
		{FlagTypeRoot, ctFlagRoot},
		{FlagTypeChallenge, ctFlagChallenge},
	} {
		t.Run(tc.flagType, func(t *testing.T) {
			mac := ComputeHMAC(secret, content, user, instance, tc.flagType, 16)
			got := BuildFlag("OFFCON{", "}", ctSlug, tc.flagType, user, mac)
			assert.Equal(t, tc.want, got,
				"wire format changed — the orchestrator mints this string")
		})
	}
}

func TestContract_NilInstanceForStaticContent(t *testing.T) {
	content, user, _ := ctIDs(t)
	mac := ComputeHMAC([]byte(ctSecret), content, user, uuid.Nil, FlagTypeChallenge, 16)
	assert.Equal(t, ctFlagNilInst, BuildFlag("OFFCON{", "}", ctSlug, FlagTypeChallenge, user, mac))
}

// The reason the flag type is inside the signed message: without it, the user
// flag and the root flag for one instance are the same string, and rooting the
// box is not required to submit the root flag.
func TestContract_UserAndRootDifferForSameInstance(t *testing.T) {
	content, user, instance := ctIDs(t)
	secret := []byte(ctSecret)
	userMAC := ComputeHMAC(secret, content, user, instance, FlagTypeUser, 16)
	rootMAC := ComputeHMAC(secret, content, user, instance, FlagTypeRoot, 16)
	assert.NotEqual(t, userMAC, rootMAC, "flag type is not bound into the HMAC")
}

// A user flag with "root" swapped into the string must not verify. This is the
// forgery the type binding exists to stop.
func TestContract_RelabellingAUserFlagAsRootFails(t *testing.T) {
	content, user, instance := ctIDs(t)
	parser := NewParser("OFFCON{", "}", 16, 256)
	v := NewVerifier(16)

	forged := "OFFCON{jeeves_root_222222_7ef023bba2f1148844db04de741c245f}" // user's HMAC, root label
	parsed, err := parser.Parse(forged)
	require.NoError(t, err, "it should parse — it is well-formed, just not authentic")

	res := v.Verify(VerifyInput{
		Flag: parsed, Secret: []byte(ctSecret),
		UserID: user, ContentID: content, InstanceID: instance,
	})
	assert.False(t, res.Valid)
	assert.Equal(t, "hmac_mismatch", res.Reason)
}

func TestContract_RoundTripParseAndVerify(t *testing.T) {
	content, user, instance := ctIDs(t)
	parser := NewParser("OFFCON{", "}", 16, 256)
	v := NewVerifier(16)

	for _, tc := range []struct{ raw, flagType string }{
		{ctFlagUser, FlagTypeUser},
		{ctFlagRoot, FlagTypeRoot},
		{ctFlagChallenge, FlagTypeChallenge},
	} {
		t.Run(tc.flagType, func(t *testing.T) {
			parsed, err := parser.Parse(tc.raw)
			require.NoError(t, err)
			assert.Equal(t, ctSlug, parsed.Slug)
			assert.Equal(t, tc.flagType, parsed.FlagType)

			res := v.Verify(VerifyInput{
				Flag: parsed, Secret: []byte(ctSecret),
				UserID: user, ContentID: content, InstanceID: instance,
			})
			require.True(t, res.Valid, "reason: %s", res.Reason)
			assert.Equal(t, tc.flagType, res.FlagType,
				"the verifier must report the type the flag carries")
		})
	}
}
