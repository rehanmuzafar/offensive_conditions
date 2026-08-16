// Package auth provides JWT validation for the scoring service.
// Reuses the same RS256 + public-key pattern as orchestrator.
package auth

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Validator struct {
	publicKey *rsa.PublicKey
	issuer    string
	audience  string
	skew      time.Duration

	mu       sync.RWMutex
	cache    map[string]*cached
	cacheTTL time.Duration
}

type cached struct {
	claims  *Claims
	cachedTo time.Time
}

type Claims struct {
	UserID    uuid.UUID
	SessionID string
	Tier      string
	Roles     []string
	ExpiresAt time.Time
}

func (c *Claims) HasRole(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type Config struct {
	PublicKeyPath string
	Issuer        string
	Audience      string
	ClockSkew     time.Duration
	CacheTTL      time.Duration
}

func NewValidator(cfg Config) (*Validator, error) {
	if cfg.PublicKeyPath == "" {
		return nil, errors.New("public key path required")
	}
	pemBytes, err := os.ReadFile(cfg.PublicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read public key: %w", err)
	}
	pub, err := jwt.ParseRSAPublicKeyFromPEM(pemBytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}
	v := &Validator{
		publicKey: pub,
		issuer:    cfg.Issuer,
		audience:  cfg.Audience,
		skew:      cfg.ClockSkew,
		cacheTTL:  cfg.CacheTTL,
	}
	if v.cacheTTL > 0 {
		v.cache = make(map[string]*cached)
	}
	return v, nil
}

func (v *Validator) Validate(tokenString string) (*Claims, error) {
	if v.cache != nil {
		v.mu.RLock()
		c, ok := v.cache[tokenString]
		v.mu.RUnlock()
		if ok && time.Now().Before(c.cachedTo) {
			return c.claims, nil
		}
	}

	type internalClaims struct {
		UserID    string   `json:"sub"`
		SessionID string   `json:"sid"`
		Tier      string   `json:"tier"`
		Roles     []string `json:"roles"`
		jwt.RegisteredClaims
	}

	var ic internalClaims
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Name}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithLeeway(v.skew),
		jwt.WithExpirationRequired(),
	)
	_, err := parser.ParseWithClaims(tokenString, &ic, func(t *jwt.Token) (interface{}, error) {
		return v.publicKey, nil
	})
	if err != nil {
		return nil, err
	}

	userID, err := uuid.Parse(ic.UserID)
	if err != nil {
		return nil, fmt.Errorf("invalid sub: %w", err)
	}
	claims := &Claims{
		UserID:    userID,
		SessionID: ic.SessionID,
		Tier:      ic.Tier,
		Roles:     ic.Roles,
		ExpiresAt: ic.ExpiresAt.Time,
	}

	if v.cache != nil {
		expiry := claims.ExpiresAt
		ttlExpiry := time.Now().Add(v.cacheTTL)
		if ttlExpiry.Before(expiry) {
			expiry = ttlExpiry
		}
		v.mu.Lock()
		v.cache[tokenString] = &cached{claims: claims, cachedTo: expiry}
		v.mu.Unlock()
	}
	return claims, nil
}
