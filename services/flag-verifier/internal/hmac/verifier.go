// Package hmac implements per-user HMAC-SHA256 flag validation.
//
// Flag format:
//
//	OFFCON{<slug>_<flag_type>_<user_short>_<HMAC_hex>}
//
// The HMAC is computed as:
//
//	HMAC-SHA256(secret, "<content_id>:<user_id>:<instance_id>:<flag_type>")[:HMACBytes]
//
// where secret comes from Vault and is unique per machine version.
//
// The flag type is part of both the string and the signed message, and that is
// load-bearing. A machine issues a user flag and a root flag for the same
// (content, user, instance) tuple; if the type were not signed, the two would
// be the same value, and owning the box as a low-privilege user would hand you
// the root flag for free. Carrying it in the string as well means the verifier
// can tell which flag was submitted instead of inferring it from machine
// metadata — inference cannot distinguish the two and silently credited the
// wrong one.
//
// This format is the platform's wire contract for flags and is implemented
// twice: here, and in the orchestrator that mints them
// (`orchestrator/internal/flag/generator.go`). The services are separate Go
// modules with separate Docker build contexts, so the code cannot be shared.
// Both sides carry the same contract test vectors instead — if you change
// anything in this file, change them together or the vectors will fail.
//
// All comparisons use constant-time equality to prevent timing attacks.
package hmac

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// FlagType values. A flag is one of these and nothing else.
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

// Parsed represents a successfully-decomposed flag string.
type Parsed struct {
	Slug      string // human-readable content slug
	FlagType  string // user | root | challenge
	UserShort string // first 6 chars of user UUID hex
	HMACHex   string // hex-encoded HMAC bytes
	Raw       string // original full flag
}

// Parser knows how to split flag strings into components.
type Parser struct {
	prefix    string
	suffix    string
	hmacChars int // 2 * hmacBytes
	maxLength int
}

func NewParser(prefix, suffix string, hmacBytes, maxLength int) *Parser {
	return &Parser{
		prefix:    prefix,
		suffix:    suffix,
		hmacChars: hmacBytes * 2,
		maxLength: maxLength,
	}
}

// Parse extracts the components from a flag string.
// Returns an error if the format is invalid.
func (p *Parser) Parse(raw string) (*Parsed, error) {
	if len(raw) > p.maxLength {
		return nil, fmt.Errorf("flag exceeds max length %d", p.maxLength)
	}
	if !strings.HasPrefix(raw, p.prefix) {
		return nil, fmt.Errorf("missing prefix %q", p.prefix)
	}
	if !strings.HasSuffix(raw, p.suffix) {
		return nil, fmt.Errorf("missing suffix %q", p.suffix)
	}

	inner := raw[len(p.prefix) : len(raw)-len(p.suffix)]
	parts := strings.Split(inner, "_")
	if len(parts) < 4 {
		return nil, fmt.Errorf("expected 4+ underscore-separated parts; got %d", len(parts))
	}

	// Read from the right: the slug is the only field that may contain "_",
	// so fixing the other three by position from the end keeps it unambiguous.
	hmacHex := parts[len(parts)-1]
	userShort := parts[len(parts)-2]
	flagType := parts[len(parts)-3]
	slug := strings.Join(parts[:len(parts)-3], "_")

	if len(hmacHex) != p.hmacChars {
		return nil, fmt.Errorf("HMAC must be %d hex chars; got %d", p.hmacChars, len(hmacHex))
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

	return &Parsed{
		Slug:      slug,
		FlagType:  flagType,
		UserShort: userShort,
		HMACHex:   hmacHex,
		Raw:       raw,
	}, nil
}

// =============================================================================
// Verifier
// =============================================================================

// Verifier validates flags against expected HMACs.
type Verifier struct {
	hmacBytes int
}

func NewVerifier(hmacBytes int) *Verifier {
	return &Verifier{hmacBytes: hmacBytes}
}

// VerifyInput is everything needed to verify a flag.
type VerifyInput struct {
	Flag       *Parsed
	Secret     []byte
	UserID     uuid.UUID
	ContentID  uuid.UUID
	InstanceID uuid.UUID // may be uuid.Nil for static challenges
}

// Result describes the verification outcome.
type Result struct {
	Valid       bool
	UserBinding bool   // does the user_short in the flag match this user?
	FlagType    string // which flag was submitted, straight from the flag itself
	Reason      string
}

// Verify checks the HMAC against the expected value.
// All comparisons are constant-time.
//
// The flag type is taken from the submitted flag and folded into the signed
// message, so a user flag cannot verify as a root flag: change the type and
// the HMAC no longer matches.
func (v *Verifier) Verify(in VerifyInput) Result {
	// 1. Check the user_short binding (defence in depth)
	expectedUserShort := userShortHex(in.UserID)
	if !constantTimeStringEqual(in.Flag.UserShort, expectedUserShort) {
		return Result{Valid: false, FlagType: in.Flag.FlagType, Reason: "user_binding_mismatch"}
	}

	// 2. Compute expected HMAC
	message := buildMessage(in.ContentID, in.UserID, in.InstanceID, in.Flag.FlagType)
	expectedHex := computeHMACHex(in.Secret, message, v.hmacBytes)

	// 3. Constant-time compare
	submittedBytes, err := hex.DecodeString(in.Flag.HMACHex)
	if err != nil {
		return Result{Valid: false, FlagType: in.Flag.FlagType, Reason: "hmac_not_hex"}
	}
	expectedBytes, _ := hex.DecodeString(expectedHex)

	if !hmac.Equal(submittedBytes, expectedBytes) {
		return Result{
			Valid: false, UserBinding: true,
			FlagType: in.Flag.FlagType, Reason: "hmac_mismatch",
		}
	}

	return Result{Valid: true, UserBinding: true, FlagType: in.Flag.FlagType}
}

// ComputeHMAC computes the canonical HMAC for a (content, user, instance, type)
// tuple. Useful for tests and for the orchestrator generating flags.
func ComputeHMAC(secret []byte, contentID, userID, instanceID uuid.UUID, flagType string, hmacBytes int) string {
	message := buildMessage(contentID, userID, instanceID, flagType)
	return computeHMACHex(secret, message, hmacBytes)
}

// BuildFlag constructs the full flag string from components.
// Mirrors what the orchestrator does. Useful for tests.
func BuildFlag(prefix, suffix, slug, flagType string, userID uuid.UUID, hmacHex string) string {
	return fmt.Sprintf("%s%s_%s_%s_%s%s", prefix, slug, flagType, userShortHex(userID), hmacHex, suffix)
}

// UserShortFor returns the user-binding component for a given UUID.
func UserShortFor(userID uuid.UUID) string {
	return userShortHex(userID)
}

// =============================================================================
// Internal helpers
// =============================================================================

// buildMessage produces the canonical input string for HMAC.
//
// We use a simple colon-separated format because:
//   - it's stable across services (orchestrator + verifier must agree)
//   - any ambiguity (e.g. instance_id containing a colon) is impossible since
//     UUIDs have a fixed character set, and the flag type is drawn from a
//     closed set that contains no colons
func buildMessage(contentID, userID, instanceID uuid.UUID, flagType string) []byte {
	// Use a fixed separator that cannot appear in UUID strings
	return []byte(fmt.Sprintf("%s:%s:%s:%s", contentID, userID, instanceID, flagType))
}

func computeHMACHex(secret, message []byte, hmacBytes int) string {
	h := hmac.New(sha256.New, secret)
	h.Write(message)
	sum := h.Sum(nil)
	if hmacBytes > len(sum) {
		hmacBytes = len(sum)
	}
	return hex.EncodeToString(sum[:hmacBytes])
}

// userShortHex returns the first 6 hex characters of the UUID (no dashes).
func userShortHex(userID uuid.UUID) string {
	hex := strings.ReplaceAll(userID.String(), "-", "")
	if len(hex) < 6 {
		return hex
	}
	return hex[:6]
}

// constantTimeStringEqual compares two strings in constant time.
// Returns false if lengths differ.
func constantTimeStringEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return hmac.Equal([]byte(a), []byte(b))
}
