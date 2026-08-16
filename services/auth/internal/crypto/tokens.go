package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
)

// RandomToken returns a URL-safe random token of the given byte length.
// The output is base64-url encoded without padding.
// Use 32 bytes (256-bit entropy) for security-sensitive tokens.
func RandomToken(byteLen int) (string, error) {
	if byteLen < 16 {
		return "", fmt.Errorf("token length must be at least 16 bytes")
	}
	b := make([]byte, byteLen)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken computes SHA-256 of a token and returns hex.
// Used to store refresh tokens and other secrets without exposing them at rest.
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// HMACHex computes HMAC-SHA256 of message with key, returning hex.
// Used for OAuth state signing, flag generation, etc.
func HMACHex(message, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return hex.EncodeToString(mac.Sum(nil))
}

// HMACVerify checks if expectedHex matches HMAC of message with key.
// Constant-time comparison.
func HMACVerify(message, key []byte, expectedHex string) bool {
	expected, err := hex.DecodeString(expectedHex)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return hmac.Equal(mac.Sum(nil), expected)
}

// BackupCodes generates n single-use backup codes for 2FA recovery.
// Each code is 10 alphanumeric characters (~60 bits of entropy).
func BackupCodes(n int) ([]string, error) {
	codes := make([]string, n)
	for i := range codes {
		code, err := RandomToken(8)
		if err != nil {
			return nil, err
		}
		// Take first 10 chars, all base64 chars are URL-safe
		if len(code) >= 10 {
			code = code[:10]
		}
		codes[i] = code
	}
	return codes, nil
}

// APIKeyPrefix returns the visible prefix of an API key.
// Format: "offcon_<8-char-public-id>" for user-facing display.
func APIKeyPrefix(rawKey string) string {
	if len(rawKey) < 16 {
		return ""
	}
	// Take first 12 chars after "offcon_" prefix for display
	return rawKey[:16]
}

// GenerateAPIKey produces a new API key (raw + hash).
// Returns (rawKey, sha256Hex). The raw key is shown to the user once.
func GenerateAPIKey() (raw string, hash string, err error) {
	body, err := RandomToken(32)
	if err != nil {
		return "", "", err
	}
	raw = "offcon_" + body
	hash = HashToken(raw)
	return raw, hash, nil
}
