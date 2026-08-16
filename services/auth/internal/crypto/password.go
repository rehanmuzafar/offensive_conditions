package crypto

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2idParams controls password hashing.
// Production defaults: t=2, m=64MB, p=1, salt=16B, key=32B
// These params take ~50ms on a modern server, providing strong resistance
// to GPU/ASIC cracking while remaining responsive for users.
type Argon2idParams struct {
	Time    uint32
	Memory  uint32 // KB
	Threads uint8
	KeyLen  uint32
	SaltLen uint32
}

// DefaultArgon2idParams returns OWASP-recommended defaults for 2024+.
func DefaultArgon2idParams() Argon2idParams {
	return Argon2idParams{
		Time:    2,
		Memory:  64 * 1024, // 64 MiB
		Threads: 1,
		KeyLen:  32,
		SaltLen: 16,
	}
}

// HashPassword hashes a plaintext password with Argon2id.
// Output format (PHC standard): $argon2id$v=19$m=65536,t=2,p=1$<salt-b64>$<hash-b64>
func HashPassword(password string, p Argon2idParams) (string, error) {
	if password == "" {
		return "", errors.New("password is empty")
	}
	salt := make([]byte, p.SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read random salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, p.KeyLen)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		p.Memory, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

// VerifyPassword checks a plaintext password against an Argon2id hash.
// Uses constant-time comparison to prevent timing attacks.
// Returns (valid, needsRehash, err). needsRehash signals that params changed
// and the password should be re-hashed at next login (transparent upgrade).
func VerifyPassword(password, encoded string, current Argon2idParams) (bool, bool, error) {
	if password == "" || encoded == "" {
		return false, false, errors.New("password or hash is empty")
	}

	params, salt, hash, err := decodeArgon2id(encoded)
	if err != nil {
		return false, false, fmt.Errorf("decode hash: %w", err)
	}

	computed := argon2.IDKey([]byte(password), salt, params.Time, params.Memory, params.Threads, params.KeyLen)

	if subtle.ConstantTimeCompare(hash, computed) != 1 {
		return false, false, nil
	}

	// Verify if hash uses outdated params
	needsRehash := params.Time != current.Time ||
		params.Memory != current.Memory ||
		params.Threads != current.Threads ||
		params.KeyLen != current.KeyLen

	return true, needsRehash, nil
}

func decodeArgon2id(encoded string) (Argon2idParams, []byte, []byte, error) {
	var p Argon2idParams
	parts := strings.Split(encoded, "$")
	// Expect: ["", "argon2id", "v=19", "m=65536,t=2,p=1", "<salt>", "<hash>"]
	if len(parts) != 6 {
		return p, nil, nil, errors.New("invalid hash format")
	}
	if parts[1] != "argon2id" {
		return p, nil, nil, fmt.Errorf("unsupported algorithm: %s", parts[1])
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return p, nil, nil, fmt.Errorf("parse version: %w", err)
	}
	if version != argon2.Version {
		return p, nil, nil, fmt.Errorf("unsupported argon2 version: %d", version)
	}

	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.Memory, &p.Time, &p.Threads); err != nil {
		return p, nil, nil, fmt.Errorf("parse params: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return p, nil, nil, fmt.Errorf("decode salt: %w", err)
	}
	p.SaltLen = uint32(len(salt))

	hash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return p, nil, nil, fmt.Errorf("decode hash: %w", err)
	}
	p.KeyLen = uint32(len(hash))

	return p, salt, hash, nil
}

// ValidatePasswordStrength checks basic complexity rules.
// Returns nil if the password meets all requirements.
func ValidatePasswordStrength(password string, minLength int) error {
	if len(password) < minLength {
		return fmt.Errorf("password must be at least %d characters", minLength)
	}
	if len(password) > 128 {
		return errors.New("password must be at most 128 characters")
	}

	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, r := range password {
		switch {
		case 'A' <= r && r <= 'Z':
			hasUpper = true
		case 'a' <= r && r <= 'z':
			hasLower = true
		case '0' <= r && r <= '9':
			hasDigit = true
		default:
			hasSpecial = true
		}
	}

	missing := []string{}
	if !hasUpper {
		missing = append(missing, "uppercase letter")
	}
	if !hasLower {
		missing = append(missing, "lowercase letter")
	}
	if !hasDigit {
		missing = append(missing, "digit")
	}
	if !hasSpecial {
		missing = append(missing, "special character")
	}

	if len(missing) > 0 {
		return fmt.Errorf("password must contain: %s", strings.Join(missing, ", "))
	}
	return nil
}
