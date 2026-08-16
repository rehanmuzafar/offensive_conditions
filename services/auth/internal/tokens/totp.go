package tokens

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTPManager handles TOTP generation and verification (RFC 6238).
type TOTPManager struct {
	issuer string
	period uint // Seconds per code (typically 30)
	digits otp.Digits
	algo   otp.Algorithm
	skew   uint // Number of periods to look back/forward (handles clock drift)
}

// NewTOTPManager returns a default-configured manager.
// 30s period, 6 digits, SHA-1 (compatible with Google Authenticator, Authy, etc.)
func NewTOTPManager(issuer string) *TOTPManager {
	return &TOTPManager{
		issuer: issuer,
		period: 30,
		digits: otp.DigitsSix,
		algo:   otp.AlgorithmSHA1,
		skew:   1, // Accept previous and next period (±30s tolerance)
	}
}

// Enrollment is the data returned during TOTP setup.
type Enrollment struct {
	Secret    string // Base32 secret to store (encrypted) for the user
	URI       string // otpauth:// URI for QR code generation
	QRPNGData []byte // Optional: pre-rendered QR code PNG bytes
}

// GenerateSecret creates a new TOTP secret for a user.
// AccountName is typically the user's email.
func (m *TOTPManager) GenerateSecret(accountName string) (*Enrollment, error) {
	// Generate 20 bytes (160 bits) of entropy, base32-encoded
	secretBytes := make([]byte, 20)
	if _, err := rand.Read(secretBytes); err != nil {
		return nil, fmt.Errorf("generate TOTP secret: %w", err)
	}
	secret := strings.TrimRight(base32.StdEncoding.EncodeToString(secretBytes), "=")

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      m.issuer,
		AccountName: accountName,
		Secret:      secretBytes,
		Period:      m.period,
		Digits:      m.digits,
		Algorithm:   m.algo,
	})
	if err != nil {
		return nil, fmt.Errorf("generate TOTP key: %w", err)
	}

	return &Enrollment{
		Secret: secret,
		URI:    key.URL(),
	}, nil
}

// Validate checks a user-submitted TOTP code against the stored secret.
// Returns true if the code is valid within the skew window.
func (m *TOTPManager) Validate(code, secret string) (bool, error) {
	// Strip whitespace and dashes for user input convenience
	code = strings.NewReplacer(" ", "", "-", "").Replace(code)
	if len(code) != int(m.digits.Length()) {
		return false, nil
	}

	valid, err := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period:    m.period,
		Skew:      m.skew,
		Digits:    m.digits,
		Algorithm: m.algo,
	})
	if err != nil {
		// Common cases (bad base32, etc.) — treat as invalid, don't leak error
		return false, nil
	}
	return valid, nil
}
