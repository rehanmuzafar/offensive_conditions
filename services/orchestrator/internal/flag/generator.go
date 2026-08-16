// Package flag generates per-user, per-instance flags for lab machines.
//
// Design goals:
//   1. Each user gets a unique flag for the same machine (prevents flag sharing)
//   2. Flags are deterministic from a stable input (regenerable for support)
//   3. Plaintext flag is never stored — only its SHA-256 hash
//   4. The HMAC secret is in Vault; rotating it invalidates all old flags
//
// Format: OFFCON{base32(hmac_truncated)} — 26 chars total (4 + 1 + 20 + 1)
package flag

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Generator produces flags using HMAC-SHA256.
type Generator struct {
	secret []byte
	prefix string
}

func NewGenerator(secret []byte, prefix string) *Generator {
	if prefix == "" {
		prefix = "OFFCON"
	}
	return &Generator{secret: secret, prefix: prefix}
}

// Generate creates a unique flag string for a (user, machine, flagType) tuple.
//
//	flagType is "user" or "root" (or any other category the machine supports)
//
// The instanceID is included so each spawn produces a different flag —
// even if a user re-spawns the same machine they can't reuse old flags.
func (g *Generator) Generate(userID, machineID, instanceID uuid.UUID, flagType string) (raw, hashHex string) {
	msg := fmt.Sprintf("%s|%s|%s|%s", userID, machineID, instanceID, flagType)
	mac := hmac.New(sha256.New, g.secret)
	mac.Write([]byte(msg))
	sum := mac.Sum(nil)

	// Take first 16 bytes (128 bits) → base32 (26 chars without padding)
	body := strings.TrimRight(base32.StdEncoding.EncodeToString(sum[:16]), "=")
	raw = fmt.Sprintf("%s{%s}", g.prefix, body)

	// Hash the raw flag for storage
	h := sha256.Sum256([]byte(raw))
	hashHex = hex.EncodeToString(h[:])
	return raw, hashHex
}

// Verify checks if a submitted flag matches the stored hash.
// Constant-time comparison.
func (g *Generator) Verify(submitted, hashHex string) bool {
	submitted = strings.TrimSpace(submitted)
	h := sha256.Sum256([]byte(submitted))
	got := hex.EncodeToString(h[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(hashHex)) == 1
}

// IsWellFormed checks the surface syntax (cheap pre-check before DB lookup).
func (g *Generator) IsWellFormed(submitted string) bool {
	s := strings.TrimSpace(submitted)
	if !strings.HasPrefix(s, g.prefix+"{") || !strings.HasSuffix(s, "}") {
		return false
	}
	body := s[len(g.prefix)+1 : len(s)-1]
	// 16 bytes → 26 base32 chars
	if len(body) != 26 {
		return false
	}
	return true
}

// HashSubmitted computes the storage hash from a user input (for re-checking).
func HashSubmitted(submitted string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(submitted)))
	return hex.EncodeToString(h[:])
}
