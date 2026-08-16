package crypto_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/auth/internal/crypto"
)

func TestArgon2idHashAndVerify(t *testing.T) {
	params := crypto.DefaultArgon2idParams()
	password := "CorrectHorseBatteryStaple1!"

	hash, err := crypto.HashPassword(password, params)
	require.NoError(t, err)

	// Hash format: $argon2id$v=19$m=65536,t=2,p=1$<salt>$<hash>
	parts := strings.Split(hash, "$")
	require.Len(t, parts, 6)
	require.Equal(t, "argon2id", parts[1])
	require.Equal(t, "v=19", parts[2])

	valid, needsRehash, err := crypto.VerifyPassword(password, hash, params)
	require.NoError(t, err)
	require.True(t, valid)
	require.False(t, needsRehash)

	// Wrong password should fail
	valid, _, err = crypto.VerifyPassword("wrong", hash, params)
	require.NoError(t, err)
	require.False(t, valid)
}

func TestArgon2idNeedsRehash(t *testing.T) {
	oldParams := crypto.Argon2idParams{
		Time: 1, Memory: 32 * 1024, Threads: 1, KeyLen: 32, SaltLen: 16,
	}
	newParams := crypto.DefaultArgon2idParams()

	password := "CorrectHorseBatteryStaple1!"
	hash, err := crypto.HashPassword(password, oldParams)
	require.NoError(t, err)

	valid, needsRehash, err := crypto.VerifyPassword(password, hash, newParams)
	require.NoError(t, err)
	require.True(t, valid)
	require.True(t, needsRehash, "should signal rehash when params changed")
}

func TestPasswordStrengthValidation(t *testing.T) {
	tests := []struct {
		name     string
		password string
		minLen   int
		wantErr  bool
	}{
		{"valid", "Strong1!Password", 12, false},
		{"too short", "Sh0rt!", 12, true},
		{"no upper", "lowercase1!password", 12, true},
		{"no lower", "UPPERCASE1!PASSWORD", 12, true},
		{"no digit", "NoDigits!Password", 12, true},
		{"no special", "NoSpecial1Password", 12, true},
		{"unicode special", "Strong1αPassword", 12, false},
		{"too long", strings.Repeat("a", 130), 12, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := crypto.ValidatePasswordStrength(tt.password, tt.minLen)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestRandomToken(t *testing.T) {
	t.Run("rejects short length", func(t *testing.T) {
		_, err := crypto.RandomToken(8)
		require.Error(t, err)
	})

	t.Run("produces URL-safe unique tokens", func(t *testing.T) {
		seen := make(map[string]bool)
		for i := 0; i < 100; i++ {
			tok, err := crypto.RandomToken(32)
			require.NoError(t, err)
			require.False(t, seen[tok], "duplicate token produced")
			seen[tok] = true
			// Must be URL-safe (no =, /, +)
			require.NotContains(t, tok, "=")
			require.NotContains(t, tok, "/")
			require.NotContains(t, tok, "+")
		}
	})
}

func TestHashTokenStable(t *testing.T) {
	tok := "test-token-value-123"
	h1 := crypto.HashToken(tok)
	h2 := crypto.HashToken(tok)
	require.Equal(t, h1, h2)
	require.Len(t, h1, 64) // SHA-256 hex = 64 chars

	// Different inputs produce different hashes
	require.NotEqual(t, h1, crypto.HashToken("different"))
}

func TestHMACVerify(t *testing.T) {
	key := []byte("super-secret-key")
	msg := []byte("important message")

	sig := crypto.HMACHex(msg, key)
	require.True(t, crypto.HMACVerify(msg, key, sig))

	// Tampered message fails
	require.False(t, crypto.HMACVerify([]byte("tampered"), key, sig))

	// Wrong key fails
	require.False(t, crypto.HMACVerify(msg, []byte("wrong-key"), sig))

	// Invalid hex fails gracefully
	require.False(t, crypto.HMACVerify(msg, key, "not-hex-zzzzzz"))
}

func TestAESRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	plaintext := []byte("totp-secret-base32-encoded-value-here")
	ciphertext, err := crypto.Encrypt(plaintext, key)
	require.NoError(t, err)

	// Encrypted output should differ each time (random nonce)
	ciphertext2, err := crypto.Encrypt(plaintext, key)
	require.NoError(t, err)
	require.NotEqual(t, ciphertext, ciphertext2)

	// Decrypt round-trip
	decrypted, err := crypto.Decrypt(ciphertext, key)
	require.NoError(t, err)
	require.Equal(t, plaintext, decrypted)

	// Wrong key fails (AES-GCM auth tag)
	wrongKey := make([]byte, 32)
	_, err = crypto.Decrypt(ciphertext, wrongKey)
	require.Error(t, err)
}

func TestAESKeyValidation(t *testing.T) {
	_, err := crypto.Encrypt([]byte("data"), []byte("too-short"))
	require.Error(t, err)

	_, err = crypto.Decrypt("anything", []byte("too-short"))
	require.Error(t, err)
}

func TestBackupCodes(t *testing.T) {
	codes, err := crypto.BackupCodes(10)
	require.NoError(t, err)
	require.Len(t, codes, 10)

	seen := make(map[string]bool)
	for _, c := range codes {
		require.Len(t, c, 10)
		require.False(t, seen[c], "duplicate backup code")
		seen[c] = true
	}
}

func TestAPIKeyGeneration(t *testing.T) {
	raw, hash, err := crypto.GenerateAPIKey()
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(raw, "offcon_"))
	require.Len(t, hash, 64) // SHA-256 hex
	require.Equal(t, hash, crypto.HashToken(raw))
}
