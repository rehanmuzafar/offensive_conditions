package tokens

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims is the JWT payload structure.
type Claims struct {
	UserID    string   `json:"sub"`
	SessionID string   `json:"sid"`
	// Username lets other services show a name without calling back to auth —
	// scoreboards and forums were rendering raw user ids without it.
	Username  string   `json:"username,omitempty"`
	Tier      string   `json:"tier"`
	Roles     []string `json:"roles"`
	jwt.RegisteredClaims
}

// JWTIssuer signs and verifies JWTs using RS256.
// Asymmetric keys allow other services to verify tokens without the signing key.
type JWTIssuer struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	issuer     string
	audience   string
	accessTTL  time.Duration
	clockSkew  time.Duration
}

type JWTConfig struct {
	PrivateKeyPath string
	PublicKeyPath  string
	Issuer         string
	Audience       string
	AccessTTL      time.Duration
	ClockSkew      time.Duration
}

// NewJWTIssuer loads RSA keys from PEM files on disk.
// In production these come from a Kubernetes Secret mounted as files.
func NewJWTIssuer(cfg JWTConfig) (*JWTIssuer, error) {
	privBytes, err := os.ReadFile(cfg.PrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read private key: %w", err)
	}
	priv, err := jwt.ParseRSAPrivateKeyFromPEM(privBytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	pubBytes, err := os.ReadFile(cfg.PublicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read public key: %w", err)
	}
	pub, err := jwt.ParseRSAPublicKeyFromPEM(pubBytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}

	return &JWTIssuer{
		privateKey: priv,
		publicKey:  pub,
		issuer:     cfg.Issuer,
		audience:   cfg.Audience,
		accessTTL:  cfg.AccessTTL,
		clockSkew:  cfg.ClockSkew,
	}, nil
}

// IssueAccessToken creates a signed JWT for the user.
func (j *JWTIssuer) IssueAccessToken(userID, sessionID, username, tier string, roles []string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		Username:  username,
		Tier:      tier,
		Roles:     roles,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    j.issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{j.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(j.accessTTL)),
			ID:        uuid.NewString(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(j.privateKey)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// Verify checks signature, expiry, issuer, and audience.
func (j *JWTIssuer) Verify(tokenString string) (*Claims, error) {
	claims := &Claims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Name}),
		jwt.WithIssuer(j.issuer),
		jwt.WithAudience(j.audience),
		jwt.WithLeeway(j.clockSkew),
		jwt.WithExpirationRequired(),
	)

	_, err := parser.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		return j.publicKey, nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		if errors.Is(err, jwt.ErrTokenSignatureInvalid) {
			return nil, ErrInvalidSignature
		}
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	if claims.UserID == "" {
		return nil, fmt.Errorf("%w: missing sub claim", ErrInvalidToken)
	}

	return claims, nil
}

// PublicKey returns the RSA public key for other services to verify tokens.
func (j *JWTIssuer) PublicKey() *rsa.PublicKey {
	return j.publicKey
}

var (
	ErrInvalidToken     = errors.New("invalid token")
	ErrTokenExpired     = errors.New("token expired")
	ErrInvalidSignature = errors.New("invalid signature")
)
