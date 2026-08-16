package tokens_test

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/auth/internal/tokens"
)

// genTestKeys creates RSA keypair files in a temp dir and returns the paths.
func genTestKeys(t *testing.T) (privPath, pubPath string) {
	t.Helper()
	dir := t.TempDir()

	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	privBytes := x509.MarshalPKCS1PrivateKey(priv)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privBytes})
	privPath = filepath.Join(dir, "priv.pem")
	require.NoError(t, os.WriteFile(privPath, privPEM, 0o600))

	pubBytes, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	require.NoError(t, err)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})
	pubPath = filepath.Join(dir, "pub.pem")
	require.NoError(t, os.WriteFile(pubPath, pubPEM, 0o644))

	return privPath, pubPath
}

func newTestIssuer(t *testing.T, accessTTL time.Duration) *tokens.JWTIssuer {
	t.Helper()
	privPath, pubPath := genTestKeys(t)
	iss, err := tokens.NewJWTIssuer(tokens.JWTConfig{
		PrivateKeyPath: privPath,
		PublicKeyPath:  pubPath,
		Issuer:         "https://test.offensiveconditions.org",
		Audience:       "test-api",
		AccessTTL:      accessTTL,
		ClockSkew:      5 * time.Second,
	})
	require.NoError(t, err)
	return iss
}

func TestJWTIssueAndVerify(t *testing.T) {
	iss := newTestIssuer(t, 15*time.Minute)

	tok, err := iss.IssueAccessToken("user-123", "sess-456", "pro", []string{"user", "moderator"})
	require.NoError(t, err)
	require.NotEmpty(t, tok)

	// JWT has 3 parts separated by dots
	require.Equal(t, 3, strings.Count(tok, ".")+0, "expected JWT to have header.payload.signature")

	claims, err := iss.Verify(tok)
	require.NoError(t, err)
	require.Equal(t, "user-123", claims.UserID)
	require.Equal(t, "sess-456", claims.SessionID)
	require.Equal(t, "pro", claims.Tier)
	require.ElementsMatch(t, []string{"user", "moderator"}, claims.Roles)
	require.Equal(t, "https://test.offensiveconditions.org", claims.Issuer)
}

func TestJWTExpired(t *testing.T) {
	iss := newTestIssuer(t, 1*time.Millisecond)
	tok, err := iss.IssueAccessToken("u1", "s1", "free", []string{"user"})
	require.NoError(t, err)

	// Wait past TTL + skew
	time.Sleep(10 * time.Second)

	_, err = iss.Verify(tok)
	require.ErrorIs(t, err, tokens.ErrTokenExpired)
}

func TestJWTBadSignature(t *testing.T) {
	iss1 := newTestIssuer(t, 15*time.Minute)
	iss2 := newTestIssuer(t, 15*time.Minute)

	tok, err := iss1.IssueAccessToken("u1", "s1", "free", []string{"user"})
	require.NoError(t, err)

	// Token issued by iss1 cannot be verified by iss2 (different keys)
	_, err = iss2.Verify(tok)
	require.Error(t, err)
}

func TestJWTTampered(t *testing.T) {
	iss := newTestIssuer(t, 15*time.Minute)
	tok, err := iss.IssueAccessToken("u1", "s1", "free", []string{"user"})
	require.NoError(t, err)

	// Flip a character in the payload section
	parts := strings.Split(tok, ".")
	require.Len(t, parts, 3)
	tampered := parts[0] + "." + flipChar(parts[1]) + "." + parts[2]

	_, err = iss.Verify(tampered)
	require.Error(t, err)
}

func flipChar(s string) string {
	if len(s) == 0 {
		return s
	}
	b := []byte(s)
	if b[len(b)/2] == 'A' {
		b[len(b)/2] = 'B'
	} else {
		b[len(b)/2] = 'A'
	}
	return string(b)
}

func TestJWTInvalidToken(t *testing.T) {
	iss := newTestIssuer(t, 15*time.Minute)
	_, err := iss.Verify("not-a-real-jwt")
	require.Error(t, err)

	_, err = iss.Verify("")
	require.Error(t, err)
}
