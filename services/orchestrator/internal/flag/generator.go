// Package flag generates per-user, per-instance flags for lab machines.
//
// Design goals:
//  1. Each user gets a unique flag for the same machine (prevents flag sharing)
//  2. Flags are deterministic from a stable input (regenerable for support)
//  3. Plaintext flag is never stored — only its SHA-256 hash
//  4. The HMAC secret is in Vault; rotating it invalidates all old flags
//
// Format: OFFCON{<slug>_<flag_type>_<user_short>_<HMAC_hex>}
//
// The HMAC is computed as:
//
//	HMAC-SHA256(secret, "<content_id>:<user_id>:<instance_id>:<flag_type>")[:HMACBytes]
//
// This is the platform's wire contract for flags, and it is implemented twice:
// here, and in the service that verifies them
// (`flag-verifier/internal/hmac/verifier.go`). The two are separate Go modules
// with separate Docker build contexts, so the code cannot be shared. Both sides
// carry the same contract test vectors instead — if you change anything about
// the format or the message, change them together or the vectors will fail.
//
// Earlier this package emitted OFFCON{base32(hmac(user|machine|instance|type))}
// and flag-verifier expected something else entirely, so a flag minted here
// could never be verified there. Nothing had been minted yet when that was
// corrected.
package flag

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// HMACBytes is the truncation length of the signature, in bytes. 16 bytes is
// 128 bits of forgery resistance and 32 hex characters in the flag. It must
// match FLAG_HMAC_BYTES in flag-verifier.
const HMACBytes = 16

// Flag types this package mints. Must match flag-verifier's set.
const (
	FlagTypeUser      = "user"
	FlagTypeRoot      = "root"
	FlagTypeChallenge = "challenge"
)

// ValidFlagType reports whether s is a flag type this platform issues.
func ValidFlagType(s string) bool {
	switch s {
	case FlagTypeUser, FlagTypeRoot, FlagTypeChallenge:
		return true
	}
	return false
}

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

// Generate creates a unique flag for a (content, user, instance, type) tuple.
//
// flagType is "user", "root" or "challenge". It is signed as well as printed:
// a machine issues a user flag and a root flag for the same instance, and if
// the type were not part of the message the two would be identical — owning
// the box as an unprivileged user would yield the root flag for free.
//
// The instanceID is included so each spawn produces a different flag — even if
// a user re-spawns the same machine they can't reuse old flags.
func (g *Generator) Generate(contentID, userID, instanceID uuid.UUID, slug, flagType string) (raw, hashHex string) {
	body := ComputeHMAC(g.secret, contentID, userID, instanceID, flagType)
	raw = fmt.Sprintf("%s{%s_%s_%s_%s}", g.prefix, slug, flagType, UserShortFor(userID), body)

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
	_, err := g.Parse(submitted)
	return err == nil
}

// Parsed is the decomposition of a flag string. Mirrors flag-verifier's.
type Parsed struct {
	Slug      string
	FlagType  string
	UserShort string
	HMACHex   string
}

// Parse splits a flag into its components, rejecting anything malformed.
func (g *Generator) Parse(submitted string) (*Parsed, error) {
	s := strings.TrimSpace(submitted)
	if !strings.HasPrefix(s, g.prefix+"{") || !strings.HasSuffix(s, "}") {
		return nil, fmt.Errorf("missing %s{...} wrapper", g.prefix)
	}
	inner := s[len(g.prefix)+1 : len(s)-1]

	parts := strings.Split(inner, "_")
	if len(parts) < 4 {
		return nil, fmt.Errorf("expected 4+ underscore-separated parts; got %d", len(parts))
	}
	// Read from the right: the slug is the only field that may contain "_".
	hmacHex := parts[len(parts)-1]
	userShort := parts[len(parts)-2]
	flagType := parts[len(parts)-3]
	slug := strings.Join(parts[:len(parts)-3], "_")

	if len(hmacHex) != HMACBytes*2 {
		return nil, fmt.Errorf("HMAC must be %d hex chars; got %d", HMACBytes*2, len(hmacHex))
	}
	if _, err := hex.DecodeString(hmacHex); err != nil {
		return nil, fmt.Errorf("HMAC is not hex: %w", err)
	}
	if len(userShort) != 6 {
		return nil, fmt.Errorf("user short must be 6 hex chars; got %d", len(userShort))
	}
	if _, err := hex.DecodeString(userShort); err != nil {
		return nil, fmt.Errorf("user short is not hex: %w", err)
	}
	if !ValidFlagType(flagType) {
		return nil, fmt.Errorf("unknown flag type %q", flagType)
	}
	if slug == "" {
		return nil, fmt.Errorf("slug is empty")
	}
	return &Parsed{Slug: slug, FlagType: flagType, UserShort: userShort, HMACHex: hmacHex}, nil
}

// HashSubmitted computes the storage hash from a user input (for re-checking).
func HashSubmitted(submitted string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(submitted)))
	return hex.EncodeToString(h[:])
}

// =============================================================================
// Canonical scheme — keep byte-identical to flag-verifier/internal/hmac
// =============================================================================

// ComputeHMAC computes the canonical HMAC for a (content, user, instance, type)
// tuple.
func ComputeHMAC(secret []byte, contentID, userID, instanceID uuid.UUID, flagType string) string {
	// Use a fixed separator that cannot appear in UUID strings, and a flag type
	// drawn from a closed set that contains no colons.
	message := []byte(fmt.Sprintf("%s:%s:%s:%s", contentID, userID, instanceID, flagType))
	h := hmac.New(sha256.New, secret)
	h.Write(message)
	return hex.EncodeToString(h.Sum(nil)[:HMACBytes])
}

// UserShortFor returns the first 6 hex characters of the UUID (no dashes).
func UserShortFor(userID uuid.UUID) string {
	s := strings.ReplaceAll(userID.String(), "-", "")
	if len(s) < 6 {
		return s
	}
	return s[:6]
}
