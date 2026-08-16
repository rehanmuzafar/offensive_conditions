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

	raw, hash := g.Generate(userID, machineID, instanceID, "user")

	assert.True(t, strings.HasPrefix(raw, "OFFCON{"), "should have prefix")
	assert.True(t, strings.HasSuffix(raw, "}"), "should have closing brace")
	assert.NotEmpty(t, hash, "hash should be populated")
	assert.Len(t, hash, 64, "SHA-256 hex should be 64 chars")
	assert.NotContains(t, hash, raw, "hash must not contain raw flag")
}

func TestGenerator_Generate_Deterministic(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	userID, machineID, instanceID := uuid.New(), uuid.New(), uuid.New()

	a, _ := g.Generate(userID, machineID, instanceID, "user")
	b, _ := g.Generate(userID, machineID, instanceID, "user")

	assert.Equal(t, a, b, "same inputs should produce same flag")
}

func TestGenerator_Generate_UniquePerUser(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	machineID := uuid.New()
	instanceID := uuid.New()

	user1, _ := g.Generate(uuid.New(), machineID, instanceID, "user")
	user2, _ := g.Generate(uuid.New(), machineID, instanceID, "user")

	assert.NotEqual(t, user1, user2, "different users get different flags")
}

func TestGenerator_Generate_UniquePerFlagType(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	userID, machineID, instanceID := uuid.New(), uuid.New(), uuid.New()

	userFlag, _ := g.Generate(userID, machineID, instanceID, "user")
	rootFlag, _ := g.Generate(userID, machineID, instanceID, "root")

	assert.NotEqual(t, userFlag, rootFlag, "user vs root flags must differ")
}

func TestGenerator_Verify_Correct(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	raw, hash := g.Generate(uuid.New(), uuid.New(), uuid.New(), "user")

	assert.True(t, g.Verify(raw, hash), "raw should verify against its hash")
	assert.True(t, g.Verify("  "+raw+"  ", hash), "should strip whitespace")
}

func TestGenerator_Verify_Incorrect(t *testing.T) {
	g := NewGenerator([]byte("test-secret"), "OFFCON")
	_, hash := g.Generate(uuid.New(), uuid.New(), uuid.New(), "user")

	assert.False(t, g.Verify("OFFCON{WRONGFLAGWRONGFLAGWRO}", hash))
	assert.False(t, g.Verify("", hash))
	assert.False(t, g.Verify("nonsense", hash))
}

func TestGenerator_IsWellFormed(t *testing.T) {
	g := NewGenerator([]byte("secret"), "OFFCON")

	cases := []struct {
		input string
		valid bool
	}{
		{"OFFCON{ABCDEFGHIJKLMNOPQRSTUVWXYZ}", true},
		{"OFFCON{ABCDE}", false},                              // too short body
		{"OFFCON{ABCDEFGHIJKLMNOPQRSTUVWXYZ", false},          // no closing
		{"HTBA{ABCDEFGHIJKLMNOPQRSTUVWXYZ}", false},           // wrong prefix
		{"random", false},
		{"", false},
		{"  OFFCON{ABCDEFGHIJKLMNOPQRSTUVWXYZ}  ", true},      // strips spaces
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
