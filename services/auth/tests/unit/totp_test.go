package tokens_test

import (
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/auth/internal/tokens"
)

func TestTOTPEnrollment(t *testing.T) {
	mgr := tokens.NewTOTPManager("offcon-test")

	enrollment, err := mgr.GenerateSecret("alice@example.com")
	require.NoError(t, err)

	require.NotEmpty(t, enrollment.Secret, "secret must be returned for manual entry")
	require.NotEmpty(t, enrollment.URI, "otpauth URI must be returned for QR code")

	// URI sanity check
	require.Contains(t, enrollment.URI, "otpauth://totp/")
	require.Contains(t, enrollment.URI, "issuer=offcon-test")
	require.Contains(t, enrollment.URI, "alice@example.com")
}

func TestTOTPValidate(t *testing.T) {
	mgr := tokens.NewTOTPManager("offcon-test")

	enrollment, err := mgr.GenerateSecret("user@example.com")
	require.NoError(t, err)

	// Generate a current TOTP code from the secret (same library)
	code, err := totp.GenerateCode(enrollment.Secret, time.Now())
	require.NoError(t, err)

	valid, err := mgr.Validate(code, enrollment.Secret)
	require.NoError(t, err)
	require.True(t, valid)
}

func TestTOTPRejectsWrong(t *testing.T) {
	mgr := tokens.NewTOTPManager("offcon-test")
	enrollment, err := mgr.GenerateSecret("user@example.com")
	require.NoError(t, err)

	// Random wrong codes
	wrongCodes := []string{"000000", "123456", "999999", "abcdef"}
	for _, wc := range wrongCodes {
		valid, _ := mgr.Validate(wc, enrollment.Secret)
		// Almost always false (1 in 1M chance of collision per code)
		_ = valid
	}

	// Definitely wrong length
	valid, err := mgr.Validate("1", enrollment.Secret)
	require.NoError(t, err)
	require.False(t, valid)

	valid, err = mgr.Validate("12345678", enrollment.Secret)
	require.NoError(t, err)
	require.False(t, valid)
}

func TestTOTPClockSkew(t *testing.T) {
	mgr := tokens.NewTOTPManager("offcon-test")
	enrollment, err := mgr.GenerateSecret("user@example.com")
	require.NoError(t, err)

	// Generate code for previous period (30s ago) — should still be valid due to skew=1
	pastCode, err := totp.GenerateCode(enrollment.Secret, time.Now().Add(-30*time.Second))
	require.NoError(t, err)

	valid, err := mgr.Validate(pastCode, enrollment.Secret)
	require.NoError(t, err)
	require.True(t, valid, "code from previous period should be accepted (clock skew tolerance)")
}

func TestTOTPStripsFormatting(t *testing.T) {
	mgr := tokens.NewTOTPManager("offcon-test")
	enrollment, err := mgr.GenerateSecret("user@example.com")
	require.NoError(t, err)

	code, err := totp.GenerateCode(enrollment.Secret, time.Now())
	require.NoError(t, err)

	// User types code with space (common with apps that display "123 456")
	withSpace := code[:3] + " " + code[3:]
	valid, err := mgr.Validate(withSpace, enrollment.Secret)
	require.NoError(t, err)
	require.True(t, valid)

	// With dash
	withDash := code[:3] + "-" + code[3:]
	valid, err = mgr.Validate(withDash, enrollment.Secret)
	require.NoError(t, err)
	require.True(t, valid)
}
