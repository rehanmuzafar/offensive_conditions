package flag

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerator_Generate_Format(t *testing.T) {
	g := NewGenerator([]byte("test-secret-32-bytes-min-length-x"), "OFFCON")

	userID := uuid.New()
	machineID := uuid.New()
	instanceID := uuid.New()

	raw, hash := g.Generate(machineID, userID, instanceID, "lame", FlagTypeUser)

	assert.True(t, strings.HasPrefix(raw, "OFFCON{"), "should have prefix")
	assert.True(t, strings.HasSuffix(raw, "}"), "should have closing brace")
	assert.NotEmpty(t, hash, "hash should be populated")
	assert.Len(t, hash, 64, "SHA-256 hex should be 64 chars")
	assert.NotContains(t, hash, raw, "hash must not contain raw flag")

	parsed, err := g.Parse(raw)
	require.NoError(t, err)
	assert.Equal(t, "lame", parsed.Slug)
	assert.Equal(t, FlagTypeUser, parsed.FlagType)
	assert.Equal(t, UserShortFor(userID), parsed.UserShort)
}

func TestGenerator_Generate_Deterministic(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	userID, machineID, instanceID := uuid.New(), uuid.New(), uuid.New()

	a, _ := g.Generate(machineID, userID, instanceID, "lame", FlagTypeUser)
	b, _ := g.Generate(machineID, userID, instanceID, "lame", FlagTypeUser)

	assert.Equal(t, a, b, "same inputs should produce same flag")
}

func TestGenerator_Generate_UniquePerUser(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	machineID := uuid.New()
	instanceID := uuid.New()

	user1, _ := g.Generate(machineID, uuid.New(), instanceID, "lame", FlagTypeUser)
	user2, _ := g.Generate(machineID, uuid.New(), instanceID, "lame", FlagTypeUser)

	assert.NotEqual(t, user1, user2, "different users get different flags")
}

func TestGenerator_Generate_UniquePerFlagType(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	userID, machineID, instanceID := uuid.New(), uuid.New(), uuid.New()

	userFlag, _ := g.Generate(machineID, userID, instanceID, "lame", FlagTypeUser)
	rootFlag, _ := g.Generate(machineID, userID, instanceID, "lame", FlagTypeRoot)

	assert.NotEqual(t, userFlag, rootFlag, "user vs root flags must differ")
}

func TestGenerator_Verify_Correct(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	raw, hash := g.Generate(uuid.New(), uuid.New(), uuid.New(), "lame", FlagTypeUser)

	assert.True(t, g.Verify(raw, hash), "raw should verify against its hash")
	assert.True(t, g.Verify("  "+raw+"  ", hash), "should strip whitespace")
}

func TestGenerator_Verify_Incorrect(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	_, hash := g.Generate(uuid.New(), uuid.New(), uuid.New(), "lame", FlagTypeUser)

	assert.False(t, g.Verify("OFFCON{lame_user_aaaaaa_00000000000000000000000000000000}", hash))
	assert.False(t, g.Verify("", hash))
	assert.False(t, g.Verify("nonsense", hash))
}

func TestGenerator_IsWellFormed(t *testing.T) {
	g := NewGenerator([]byte("secret"), "OFFCON")

	const good = "OFFCON{lame_user_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}"

	cases := []struct {
		input string
		valid bool
	}{
		{good, true},
		{"  " + good + "  ", true}, // strips spaces
		{"OFFCON{lame_root_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}", true},
		{"OFFCON{multi_word_slug_user_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}", true},
		{"OFFCON{lame_user_a4b9c3_d7f8e2}", false},                              // short HMAC
		{"OFFCON{lame_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}", false},         // no type
		{"OFFCON{lame_admin_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}", false},   // unknown type
		{"OFFCON{lame_user_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4", false},     // no closing
		{"HTBA{lame_user_a4b9c3_d7f8e2a1b3c9d4e5f697283abc12def4}", false},      // wrong prefix
		{"OFFCON{ABCDEFGHIJKLMNOPQRSTUVWXYZ}", false},                           // the old base32 format
		{"random", false},
		{"", false},
	}
	for _, c := range cases {
		assert.Equal(t, c.valid, g.IsWellFormed(c.input), c.input)
	}
}

func TestHashSubmitted_Stable(t *testing.T) {
	a := HashSubmitted("OFFCON{TEST}")
	b := HashSubmitted("  OFFCON{TEST}  ")
	require.Equal(t, a, b, "should be whitespace-insensitive")
}
