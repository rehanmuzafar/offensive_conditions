package hmac

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParser_HappyPath(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	flag := "OFFCON{lame_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}"
	parsed, err := p.Parse(flag)
	require.NoError(t, err)
	assert.Equal(t, "lame", parsed.Slug)
	assert.Equal(t, "a4b9c3", parsed.UserShort)
	assert.Equal(t, "d7f8e2a1b3c9d4e5f697283abc12def4", parsed.HMACHex)
	assert.Equal(t, flag, parsed.Raw)
}

func TestParser_MultiWordSlug(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	flag := "OFFCON{multi_word_slug_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}"
	parsed, err := p.Parse(flag)
	require.NoError(t, err)
	assert.Equal(t, "multi_word_slug", parsed.Slug)
}

func TestParser_InvalidPrefix(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	_, err := p.Parse("HTB{lame_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}")
	assert.Error(t, err)
}

func TestParser_InvalidSuffix(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	_, err := p.Parse("OFFCON{lame_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4")
	assert.Error(t, err)
}

func TestParser_WrongHMACLength(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	_, err := p.Parse("OFFCON{lame_a4b9c3_d7f8e2a1b3c9d4e5}")
	assert.Error(t, err)
}

func TestParser_NonHexHMAC(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	_, err := p.Parse("OFFCON{lame_a4b9c3_ZZZZZ2a1b3c9d4e5f697283abc12def4}")
	assert.Error(t, err)
}

func TestParser_TooLong(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 64)
	_, err := p.Parse("OFFCON{lame_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4_padding_padding}")
	assert.Error(t, err)
}

func TestParser_MissingUserShort(t *testing.T) {
	p := NewParser("OFFCON{", "}", 16, 256)
	_, err := p.Parse("OFFCON{lame_d7f8e2a1b3c9d4e5f697283abc12def4}")
	assert.Error(t, err) // only 2 parts after split
}

func TestVerifier_RoundTrip(t *testing.T) {
	secret := []byte("my-secret-key-for-testing")
	userID := uuid.MustParse("a4b9c3d2-1111-2222-3333-444455556666")
	contentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	instanceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	// Generator side: orchestrator builds a flag
	hmacHex := ComputeHMAC(secret, contentID, userID, instanceID, 16)
	flagStr := BuildFlag("OFFCON{", "}", "test_machine", userID, hmacHex)

	// Verifier side
	p := NewParser("OFFCON{", "}", 16, 256)
	parsed, err := p.Parse(flagStr)
	require.NoError(t, err)

	v := NewVerifier(16)
	res := v.Verify(VerifyInput{
		Flag:       parsed,
		Secret:     secret,
		UserID:     userID,
		ContentID:  contentID,
		InstanceID: instanceID,
	})

	assert.True(t, res.Valid)
	assert.True(t, res.UserBinding)
}

func TestVerifier_WrongSecret(t *testing.T) {
	correctSecret := []byte("correct-secret")
	wrongSecret := []byte("wrong-secret")
	userID := uuid.New()
	contentID := uuid.New()
	instanceID := uuid.New()

	hmacHex := ComputeHMAC(correctSecret, contentID, userID, instanceID, 16)
	flagStr := BuildFlag("OFFCON{", "}", "machine", userID, hmacHex)
	p := NewParser("OFFCON{", "}", 16, 256)
	parsed, _ := p.Parse(flagStr)

	v := NewVerifier(16)
	res := v.Verify(VerifyInput{
		Flag: parsed, Secret: wrongSecret,
		UserID: userID, ContentID: contentID, InstanceID: instanceID,
	})

	assert.False(t, res.Valid)
	assert.Equal(t, "hmac_mismatch", res.Reason)
	assert.True(t, res.UserBinding, "user binding is still correct")
}

func TestVerifier_WrongUser(t *testing.T) {
	secret := []byte("secret")
	alice := uuid.MustParse("aaaaaaaa-1111-2222-3333-444455556666")
	bob := uuid.MustParse("bbbbbbbb-1111-2222-3333-444455556666")
	contentID := uuid.New()
	instanceID := uuid.New()

	// Generate flag for Alice
	hmacHex := ComputeHMAC(secret, contentID, alice, instanceID, 16)
	flagStr := BuildFlag("OFFCON{", "}", "machine", alice, hmacHex)
	p := NewParser("OFFCON{", "}", 16, 256)
	parsed, _ := p.Parse(flagStr)

	v := NewVerifier(16)

	// Bob tries to submit Alice's flag
	res := v.Verify(VerifyInput{
		Flag: parsed, Secret: secret,
		UserID: bob, ContentID: contentID, InstanceID: instanceID,
	})

	assert.False(t, res.Valid)
	assert.False(t, res.UserBinding)
	assert.Equal(t, "user_binding_mismatch", res.Reason)
}

func TestVerifier_WrongInstance(t *testing.T) {
	secret := []byte("secret")
	userID := uuid.New()
	contentID := uuid.New()
	inst1 := uuid.New()
	inst2 := uuid.New()

	hmacHex := ComputeHMAC(secret, contentID, userID, inst1, 16)
	flagStr := BuildFlag("OFFCON{", "}", "machine", userID, hmacHex)
	p := NewParser("OFFCON{", "}", 16, 256)
	parsed, _ := p.Parse(flagStr)

	v := NewVerifier(16)
	res := v.Verify(VerifyInput{
		Flag: parsed, Secret: secret,
		UserID: userID, ContentID: contentID, InstanceID: inst2,
	})

	assert.False(t, res.Valid)
}

func TestUserShortFor(t *testing.T) {
	id := uuid.MustParse("abcdef12-3456-7890-1234-567890abcdef")
	assert.Equal(t, "abcdef", UserShortFor(id))
}

func TestComputeHMAC_DeterministicAndStable(t *testing.T) {
	secret := []byte("secret")
	userID := uuid.MustParse("a4b9c3d2-1111-2222-3333-444455556666")
	contentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	instanceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	// Same inputs → same output every time
	h1 := ComputeHMAC(secret, contentID, userID, instanceID, 16)
	h2 := ComputeHMAC(secret, contentID, userID, instanceID, 16)
	assert.Equal(t, h1, h2)

	// 32 hex chars for 16 bytes
	assert.Len(t, h1, 32)
}
