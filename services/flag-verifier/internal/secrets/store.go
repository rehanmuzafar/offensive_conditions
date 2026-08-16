// Package secrets manages per-content HMAC secrets.
//
// Production: secrets live in Vault at <prefix>/<content_id>. Vault is
// the source of truth; we cache in memory with refresh.
//
// Development: secrets can be provided via env var SECRETS_LOCAL_KEY
// (single global secret for all content) or via a static JSON file.
//
// On miss, we return ErrSecretNotFound. The orchestrator must ensure
// the secret exists before the first flag for that content is submitted.
package secrets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	vault "github.com/hashicorp/vault/api"
	"github.com/rs/zerolog"
)

var ErrSecretNotFound = errors.New("secret not found")

// Store is the abstraction over wherever HMAC secrets are stored.
type Store interface {
	GetSecret(ctx context.Context, contentID string) ([]byte, error)
	Close() error
}

// =============================================================================
// Vault-backed Store (production)
// =============================================================================

type vaultStore struct {
	client    *vault.Client
	prefix    string
	cache     map[string]cachedSecret
	mu        sync.RWMutex
	cacheTTL  time.Duration
	log       zerolog.Logger
}

type cachedSecret struct {
	value     []byte
	expiresAt time.Time
}

type VaultConfig struct {
	Addr            string
	Token           string
	TokenPath       string
	Prefix          string // e.g. "secret/data/flag-hmac"
	CacheTTL        time.Duration
	RefreshInterval time.Duration
}

// NewVaultStore creates a Vault-backed secrets store.
//
// Token resolution priority:
//  1. Token (direct, dev only)
//  2. TokenPath (file containing the token; injected by Vault Agent)
//  3. VAULT_TOKEN env var (Vault default)
func NewVaultStore(cfg VaultConfig, log zerolog.Logger) (Store, error) {
	c := vault.DefaultConfig()
	c.Address = cfg.Addr
	client, err := vault.NewClient(c)
	if err != nil {
		return nil, fmt.Errorf("create vault client: %w", err)
	}

	token := cfg.Token
	if token == "" && cfg.TokenPath != "" {
		b, err := os.ReadFile(cfg.TokenPath)
		if err != nil {
			return nil, fmt.Errorf("read vault token from %s: %w", cfg.TokenPath, err)
		}
		token = strings.TrimSpace(string(b))
	}
	if token != "" {
		client.SetToken(token)
	}

	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 5 * time.Minute
	}
	return &vaultStore{
		client:   client,
		prefix:   strings.TrimRight(cfg.Prefix, "/"),
		cache:    make(map[string]cachedSecret),
		cacheTTL: cfg.CacheTTL,
		log:      log.With().Str("component", "vault-secrets").Logger(),
	}, nil
}

func (s *vaultStore) GetSecret(ctx context.Context, contentID string) ([]byte, error) {
	// Cache hit?
	s.mu.RLock()
	c, ok := s.cache[contentID]
	s.mu.RUnlock()
	if ok && time.Now().Before(c.expiresAt) {
		return c.value, nil
	}

	// Fetch from Vault
	path := s.prefix + "/" + contentID
	secret, err := s.client.KVv2(s.kvMount()).Get(ctx, s.kvSubpath(contentID))
	if err != nil {
		if isNotFound(err) {
			return nil, ErrSecretNotFound
		}
		return nil, fmt.Errorf("vault read %s: %w", path, err)
	}
	if secret == nil || secret.Data == nil {
		return nil, ErrSecretNotFound
	}
	raw, ok := secret.Data["value"]
	if !ok {
		return nil, fmt.Errorf("vault secret %s missing 'value' field", path)
	}
	value, ok := raw.(string)
	if !ok {
		return nil, fmt.Errorf("vault secret %s 'value' is not string", path)
	}

	bytes := []byte(value)
	s.mu.Lock()
	s.cache[contentID] = cachedSecret{value: bytes, expiresAt: time.Now().Add(s.cacheTTL)}
	s.mu.Unlock()

	return bytes, nil
}

func (s *vaultStore) Close() error { return nil }

// kvMount splits the prefix to find the KV mount point.
// "secret/data/flag-hmac" → mount="secret", subpath_root="flag-hmac"
func (s *vaultStore) kvMount() string {
	parts := strings.Split(s.prefix, "/")
	if len(parts) > 0 {
		return parts[0]
	}
	return "secret"
}

func (s *vaultStore) kvSubpath(contentID string) string {
	// Drop the mount + "data" segment if present
	parts := strings.Split(s.prefix, "/")
	if len(parts) >= 2 && parts[1] == "data" {
		parts = parts[2:]
	} else if len(parts) >= 1 {
		parts = parts[1:]
	}
	return strings.Join(append(parts, contentID), "/")
}

func isNotFound(err error) bool {
	var rErr *vault.ResponseError
	if errors.As(err, &rErr) {
		return rErr.StatusCode == 404
	}
	return strings.Contains(err.Error(), "404")
}

// =============================================================================
// Static Store (dev / tests)
// =============================================================================

type staticStore struct {
	secrets map[string][]byte
	fallback []byte
}

// NewStaticStore creates a development-only secrets store with hard-coded values.
// If fallback is provided, it's returned for any content_id not explicitly mapped.
func NewStaticStore(secrets map[string]string, fallback string) Store {
	out := make(map[string][]byte, len(secrets))
	for k, v := range secrets {
		out[k] = []byte(v)
	}
	var fb []byte
	if fallback != "" {
		fb = []byte(fallback)
	}
	return &staticStore{secrets: out, fallback: fb}
}

func (s *staticStore) GetSecret(_ context.Context, contentID string) ([]byte, error) {
	if v, ok := s.secrets[contentID]; ok {
		return v, nil
	}
	if s.fallback != nil {
		return s.fallback, nil
	}
	return nil, ErrSecretNotFound
}

func (s *staticStore) Close() error { return nil }

// LoadStaticFromFile reads a JSON file mapping content_id → secret.
//
// File format:
//
//	{
//	  "_default": "fallback-secret-for-tests",
//	  "550e8400-...": "specific-secret-for-this-content"
//	}
func LoadStaticFromFile(path string) (Store, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	fallback := m["_default"]
	delete(m, "_default")
	return NewStaticStore(m, fallback), nil
}
