package oauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/offensive-conditions/auth/internal/crypto"
)

// State is the signed state parameter for OAuth redirects.
// Embeds provider, redirect target, and a nonce to prevent CSRF.
type State struct {
	Provider     string `json:"p"`
	Nonce        string `json:"n"`
	IssuedAtUnix int64  `json:"t"`
	Mode         string `json:"m"` // "login" or "link"
	UserID       string `json:"u,omitempty"` // For link mode
}

// SignState produces a tamper-evident state parameter.
// Format: base64url(json).hex(hmac)
func SignState(s State, secret []byte) (string, error) {
	if s.Nonce == "" {
		n, err := crypto.RandomToken(16)
		if err != nil {
			return "", err
		}
		s.Nonce = n
	}
	if s.IssuedAtUnix == 0 {
		s.IssuedAtUnix = time.Now().Unix()
	}

	body, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("marshal state: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(body)
	sig := crypto.HMACHex([]byte(encoded), secret)
	return encoded + "." + sig, nil
}

// VerifyState checks the HMAC and parses the state.
func VerifyState(raw string, secret []byte, maxAge time.Duration) (*State, error) {
	parts := strings.SplitN(raw, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid state format")
	}
	if !crypto.HMACVerify([]byte(parts[0]), secret, parts[1]) {
		return nil, fmt.Errorf("state signature mismatch")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}
	var s State
	if err := json.Unmarshal(body, &s); err != nil {
		return nil, fmt.Errorf("unmarshal state: %w", err)
	}
	if maxAge > 0 {
		if time.Since(time.Unix(s.IssuedAtUnix, 0)) > maxAge {
			return nil, fmt.Errorf("state expired")
		}
	}
	return &s, nil
}

// Registry holds the configured OAuth providers.
type Registry struct {
	providers map[string]Provider
}

func NewRegistry() *Registry {
	return &Registry{providers: make(map[string]Provider)}
}

func (r *Registry) Register(p Provider) {
	r.providers[p.Name()] = p
}

func (r *Registry) Get(name string) (Provider, bool) {
	p, ok := r.providers[name]
	return p, ok
}

func (r *Registry) List() []string {
	out := make([]string, 0, len(r.providers))
	for n := range r.providers {
		out = append(out, n)
	}
	return out
}

// CallbackResult is what the auth service receives after a successful OAuth callback.
type CallbackResult struct {
	Provider     string
	UserInfo     *UserInfo
	AccessToken  string
	RefreshToken string
	State        *State
}

// CompleteCallback exchanges the code and fetches user info.
func (r *Registry) CompleteCallback(ctx context.Context, providerName, code, redirectURI string, state *State) (*CallbackResult, error) {
	p, ok := r.Get(providerName)
	if !ok {
		return nil, fmt.Errorf("unknown provider: %s", providerName)
	}

	tok, err := p.Exchange(ctx, code, redirectURI)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}

	info, err := p.FetchUserInfo(ctx, tok.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("fetch userinfo: %w", err)
	}

	return &CallbackResult{
		Provider:     providerName,
		UserInfo:     info,
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		State:        state,
	}, nil
}
