//go:build integration

package integration_test

import (
	"time"

	"github.com/pquerna/otp/totp"
)

func init() {
	generateTOTPCode = func(secret string, t time.Time) (string, error) {
		return totp.GenerateCode(secret, t)
	}
}
