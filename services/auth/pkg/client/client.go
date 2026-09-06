// Package authclient provides a Go client for the Offensive Conditions auth service.
//
// Other microservices use this to validate JWTs, fetch user info, and revoke sessions
// via gRPC with mTLS.
package authclient

import (
	"context"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// Client is the auth service client.
type Client struct {
	conn      *grpc.ClientConn
	publicKey *rsa.PublicKey  // For local JWT verification (fast path)
	issuer    string
	audience  string
	skew      time.Duration

	mu     sync.RWMutex
	cache  map[string]*cachedClaims // optional in-memory cache
	cacheTTL time.Duration
}

type Config struct {
	Endpoint        string        // e.g. "auth.offcon-auth.svc.cluster.local:9001"
	TLSCertPath     string        // mTLS client cert (optional in dev)
	TLSKeyPath      string        // mTLS client key
	CAPath          string        // Trusted server CA
	Insecure        bool          // Dev mode only
	JWTPublicKeyPath string       // PEM file for local verification (skip gRPC for hot path)
	JWTIssuer       string
	JWTAudience     string
	JWTClockSkew    time.Duration
	CacheTTL        time.Duration // 0 = no cache
}

type cachedClaims struct {
	claims    *Claims
	expiresAt time.Time
}

// Claims is the decoded JWT payload.
type Claims struct {
	UserID    string
	SessionID string
	Tier      string
	Roles     []string
	ExpiresAt time.Time
}

// New constructs a client from config.
func New(cfg Config) (*Client, error) {
	var dialOpts []grpc.DialOption

	if cfg.Insecure {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	} else {
		tlsCfg, err := buildClientTLS(cfg)
		if err != nil {
			return nil, fmt.Errorf("tls: %w", err)
		}
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)))
	}

	conn, err := grpc.NewClient(cfg.Endpoint, dialOpts...)
	if err != nil {
		return nil, fmt.Errorf("grpc dial: %w", err)
	}

	c := &Client{
		conn:     conn,
		issuer:   cfg.JWTIssuer,
		audience: cfg.JWTAudience,
		skew:     cfg.JWTClockSkew,
		cacheTTL: cfg.CacheTTL,
	}

	if cfg.JWTPublicKeyPath != "" {
		pubBytes, err := os.ReadFile(cfg.JWTPublicKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read public key: %w", err)
		}
		pub, err := jwt.ParseRSAPublicKeyFromPEM(pubBytes)
		if err != nil {
			return nil, fmt.Errorf("parse public key: %w", err)
		}
		c.publicKey = pub
	}

	if c.cacheTTL > 0 {
		c.cache = make(map[string]*cachedClaims)
	}

	return c, nil
}

func buildClientTLS(cfg Config) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(cfg.TLSCertPath, cfg.TLSKeyPath)
	if err != nil {
		return nil, fmt.Errorf("load client cert: %w", err)
	}
	caBytes, err := os.ReadFile(cfg.CAPath)
	if err != nil {
		return nil, fmt.Errorf("read ca: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, errors.New("invalid CA bundle")
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// Close releases the underlying gRPC connection.
func (c *Client) Close() error {
	return c.conn.Close()
}

// ValidateToken validates a JWT.
// If a public key was loaded, verification happens locally (microseconds, no network).
// Otherwise it calls the auth service via gRPC.
func (c *Client) ValidateToken(ctx context.Context, tokenString string) (*Claims, error) {
	if c.cache != nil {
		c.mu.RLock()
		cached, ok := c.cache[tokenString]
		c.mu.RUnlock()
		if ok && time.Now().Before(cached.expiresAt) {
			return cached.claims, nil
		}
	}

	var claims *Claims
	var err error
	if c.publicKey != nil {
		claims, err = c.verifyLocal(tokenString)
	} else {
		// Fall back to gRPC call (slower path)
		return nil, errors.New("remote JWT validation not yet wired (proto stub missing)")
	}
	if err != nil {
		return nil, err
	}

	if c.cache != nil {
		// Cache until token expiry or TTL, whichever comes first
		expiry := claims.ExpiresAt
		ttlExpiry := time.Now().Add(c.cacheTTL)
		if ttlExpiry.Before(expiry) {
			expiry = ttlExpiry
		}
		c.mu.Lock()
		c.cache[tokenString] = &cachedClaims{claims: claims, expiresAt: expiry}
		c.mu.Unlock()
	}

	return claims, nil
}

func (c *Client) verifyLocal(tokenString string) (*Claims, error) {
	type localClaims struct {
		UserID    string   `json:"sub"`
		SessionID string   `json:"sid"`
		Tier      string   `json:"tier"`
		Roles     []string `json:"roles"`
		jwt.RegisteredClaims
	}

	var lc localClaims
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Name}),
		jwt.WithIssuer(c.issuer),
		jwt.WithAudience(c.audience),
		jwt.WithLeeway(c.skew),
		jwt.WithExpirationRequired(),
	)

	_, err := parser.ParseWithClaims(tokenString, &lc, func(t *jwt.Token) (interface{}, error) {
		return c.publicKey, nil
	})
	if err != nil {
		return nil, err
	}

	return &Claims{
		UserID:    lc.UserID,
		SessionID: lc.SessionID,
		Tier:      lc.Tier,
		Roles:     lc.Roles,
		ExpiresAt: lc.ExpiresAt.Time,
	}, nil
}

// HasRole returns true if the claims include the given role.
func (c *Claims) HasRole(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// UserUUID parses the UserID claim as UUID.
func (c *Claims) UserUUID() (uuid.UUID, error) {
	return uuid.Parse(c.UserID)
}

// silence
var _ = strings.Index
