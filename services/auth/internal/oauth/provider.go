package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Provider abstracts an OAuth 2.0 provider (Google, GitHub, Discord, etc.)
type Provider interface {
	Name() string
	AuthURL(state, redirectURI string) string
	Exchange(ctx context.Context, code, redirectURI string) (*TokenResponse, error)
	FetchUserInfo(ctx context.Context, accessToken string) (*UserInfo, error)
}

// TokenResponse is the standard OAuth 2.0 token endpoint response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in,omitempty"`
	Scope        string `json:"scope,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

// UserInfo is the normalized user data returned from a provider.
type UserInfo struct {
	ProviderUserID string
	Email          string
	EmailVerified  bool
	Username       string
	DisplayName    string
	AvatarURL      string
	Raw            map[string]any
}

// Config holds OAuth client credentials.
type Config struct {
	ClientID     string
	ClientSecret string
	Scopes       []string
}

// httpClient is shared across providers (5s timeout).
var httpClient = &http.Client{Timeout: 10 * time.Second}

// =============================================================================
// Google
// =============================================================================

type GoogleProvider struct {
	cfg Config
}

func NewGoogleProvider(cfg Config) *GoogleProvider {
	if len(cfg.Scopes) == 0 {
		cfg.Scopes = []string{"openid", "email", "profile"}
	}
	return &GoogleProvider{cfg: cfg}
}

func (p *GoogleProvider) Name() string { return "google" }

func (p *GoogleProvider) AuthURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(p.cfg.Scopes, " "))
	q.Set("state", state)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")
	return "https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode()
}

func (p *GoogleProvider) Exchange(ctx context.Context, code, redirectURI string) (*TokenResponse, error) {
	return exchangeToken(ctx, "https://oauth2.googleapis.com/token", p.cfg, code, redirectURI)
}

func (p *GoogleProvider) FetchUserInfo(ctx context.Context, accessToken string) (*UserInfo, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://openidconnect.googleapis.com/v1/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google userinfo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google userinfo status %d: %s", resp.StatusCode, body)
	}

	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode userinfo: %w", err)
	}

	// Google has no public username — derive a handle from the email local-part
	// (e.g. "alice@gmail.com" -> "alice") instead of the whole address.
	gEmail := asString(raw["email"])
	gUsername := gEmail
	if i := strings.IndexByte(gUsername, '@'); i > 0 {
		gUsername = gUsername[:i]
	}

	return &UserInfo{
		ProviderUserID: asString(raw["sub"]),
		Email:          gEmail,
		EmailVerified:  asBool(raw["email_verified"]),
		Username:       gUsername,
		DisplayName:    asString(raw["name"]),
		AvatarURL:      asString(raw["picture"]),
		Raw:            raw,
	}, nil
}

// =============================================================================
// GitHub
// =============================================================================

type GitHubProvider struct {
	cfg Config
}

func NewGitHubProvider(cfg Config) *GitHubProvider {
	if len(cfg.Scopes) == 0 {
		cfg.Scopes = []string{"read:user", "user:email"}
	}
	return &GitHubProvider{cfg: cfg}
}

func (p *GitHubProvider) Name() string { return "github" }

func (p *GitHubProvider) AuthURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", strings.Join(p.cfg.Scopes, " "))
	q.Set("state", state)
	return "https://github.com/login/oauth/authorize?" + q.Encode()
}

func (p *GitHubProvider) Exchange(ctx context.Context, code, redirectURI string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", p.cfg.ClientID)
	form.Set("client_secret", p.cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github token exchange: %w", err)
	}
	defer resp.Body.Close()

	var tok TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return nil, fmt.Errorf("decode token: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("github returned no access token")
	}
	return &tok, nil
}

func (p *GitHubProvider) FetchUserInfo(ctx context.Context, accessToken string) (*UserInfo, error) {
	// Fetch profile
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github user: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github user status %d: %s", resp.StatusCode, body)
	}
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	// Fetch primary email (may not be public)
	email := asString(raw["email"])
	emailVerified := false
	if email == "" {
		email, emailVerified = githubPrimaryEmail(ctx, accessToken)
	}

	return &UserInfo{
		ProviderUserID: fmt.Sprintf("%v", raw["id"]),
		Email:          email,
		EmailVerified:  emailVerified,
		Username:       asString(raw["login"]),
		DisplayName:    asString(raw["name"]),
		AvatarURL:      asString(raw["avatar_url"]),
		Raw:            raw,
	}, nil
}

func githubPrimaryEmail(ctx context.Context, accessToken string) (string, bool) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/emails", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", false
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", false
	}
	for _, e := range emails {
		if e.Primary {
			return e.Email, e.Verified
		}
	}
	return "", false
}

// =============================================================================
// Discord
// =============================================================================

type DiscordProvider struct {
	cfg Config
}

func NewDiscordProvider(cfg Config) *DiscordProvider {
	if len(cfg.Scopes) == 0 {
		cfg.Scopes = []string{"identify", "email"}
	}
	return &DiscordProvider{cfg: cfg}
}

func (p *DiscordProvider) Name() string { return "discord" }

func (p *DiscordProvider) AuthURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(p.cfg.Scopes, " "))
	q.Set("state", state)
	return "https://discord.com/api/oauth2/authorize?" + q.Encode()
}

func (p *DiscordProvider) Exchange(ctx context.Context, code, redirectURI string) (*TokenResponse, error) {
	return exchangeToken(ctx, "https://discord.com/api/oauth2/token", p.cfg, code, redirectURI)
}

func (p *DiscordProvider) FetchUserInfo(ctx context.Context, accessToken string) (*UserInfo, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://discord.com/api/users/@me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("discord user: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("discord user status %d: %s", resp.StatusCode, body)
	}
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	avatarHash := asString(raw["avatar"])
	userID := asString(raw["id"])
	avatarURL := ""
	if avatarHash != "" && userID != "" {
		avatarURL = fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", userID, avatarHash)
	}

	return &UserInfo{
		ProviderUserID: userID,
		Email:          asString(raw["email"]),
		EmailVerified:  asBool(raw["verified"]),
		Username:       asString(raw["username"]),
		DisplayName:    asString(raw["global_name"]),
		AvatarURL:      avatarURL,
		Raw:            raw,
	}, nil
}

// =============================================================================
// Helpers
// =============================================================================

// exchangeToken is the common token exchange flow for Google and Discord.
func exchangeToken(ctx context.Context, tokenURL string, cfg Config, code, redirectURI string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", redirectURI)

	req, _ := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token endpoint status %d: %s", resp.StatusCode, body)
	}

	var tok TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("no access token in response")
	}
	return &tok, nil
}

func asString(v any) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func asBool(v any) bool {
	if v == nil {
		return false
	}
	b, _ := v.(bool)
	return b
}
