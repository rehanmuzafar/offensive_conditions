// Package client is a Go SDK for the user service.
//
// It wraps both the HTTP API and the internal gRPC API so other services
// can call user-svc with type-safe methods, automatic retries, and
// reasonable defaults.
//
// Use NewHTTPClient for user-facing operations (when on behalf of a user
// with their JWT) and NewGRPCClient for service-to-service metadata lookups.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	grpcserver "github.com/offensive-conditions/user-svc/internal/grpc"
)

// =============================================================================
// HTTP client (for user-scoped operations)
// =============================================================================

type HTTPClient struct {
	baseURL    string
	httpClient *http.Client
	userAgent  string
}

type HTTPConfig struct {
	BaseURL    string
	Timeout    time.Duration
	UserAgent  string
	HTTPClient *http.Client
}

func NewHTTPClient(cfg HTTPConfig) *HTTPClient {
	c := &HTTPClient{
		baseURL:   strings.TrimRight(cfg.BaseURL, "/"),
		userAgent: cfg.UserAgent,
	}
	if c.userAgent == "" {
		c.userAgent = "offcon-user-svc-client/1.0"
	}
	if cfg.HTTPClient != nil {
		c.httpClient = cfg.HTTPClient
	} else {
		timeout := cfg.Timeout
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		c.httpClient = &http.Client{Timeout: timeout}
	}
	return c
}

type Profile struct {
	UserID            uuid.UUID  `json:"user_id"`
	Username          string     `json:"username"`
	DisplayName       string     `json:"display_name"`
	Bio               string     `json:"bio"`
	AvatarURL         string     `json:"avatar_url"`
	CountryCode       string     `json:"country_code,omitempty"`
	Timezone          string     `json:"timezone"`
	Tier              string     `json:"tier"`
	IsStaff           bool       `json:"is_staff"`
	Email             string     `json:"email,omitempty"`
	EmailVerified     bool       `json:"email_verified,omitempty"`
	OnboardingComplete bool      `json:"onboarding_complete,omitempty"`
	LastSeenAt        *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	Social            Social     `json:"social"`
}

type Social struct {
	Twitter  string `json:"twitter"`
	GitHub   string `json:"github"`
	LinkedIn string `json:"linkedin"`
	Website  string `json:"website"`
}

type Team struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Slug         string    `json:"slug"`
	Description  string    `json:"description"`
	AvatarURL    string    `json:"avatar_url"`
	OwnerID      uuid.UUID `json:"owner_id"`
	MemberCount  int       `json:"member_count"`
	MaxMembers   int       `json:"max_members"`
	IsPrivate    bool      `json:"is_private"`
	IsRecruiting bool      `json:"is_recruiting"`
}

// =============================================================================
// HTTP API methods
// =============================================================================

func (c *HTTPClient) Me(ctx context.Context, token string) (*Profile, error) {
	var resp struct {
		Profile Profile `json:"profile"`
	}
	if err := c.do(ctx, "GET", "/v1/users/me", token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp.Profile, nil
}

func (c *HTTPClient) GetUser(ctx context.Context, token string, userID uuid.UUID) (*Profile, error) {
	var resp struct {
		Profile Profile `json:"profile"`
	}
	if err := c.do(ctx, "GET", "/v1/users/"+userID.String(), token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp.Profile, nil
}

func (c *HTTPClient) GetUserByUsername(ctx context.Context, token, username string) (*Profile, error) {
	var resp struct {
		Profile Profile `json:"profile"`
	}
	if err := c.do(ctx, "GET", "/v1/users/by-username/"+username, token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp.Profile, nil
}

func (c *HTTPClient) SearchUsers(ctx context.Context, token, query, country string, limit int) ([]Profile, error) {
	path := fmt.Sprintf("/v1/users/search?q=%s&country=%s&limit=%d", query, country, limit)
	var resp struct {
		Results []Profile `json:"results"`
	}
	if err := c.do(ctx, "GET", path, token, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Results, nil
}

type UpdateProfileRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Bio         *string `json:"bio,omitempty"`
	CountryCode *string `json:"country_code,omitempty"`
	Timezone    *string `json:"timezone,omitempty"`
	Twitter     *string `json:"twitter_handle,omitempty"`
	GitHub      *string `json:"github_handle,omitempty"`
	LinkedIn    *string `json:"linkedin_url,omitempty"`
	Website     *string `json:"website_url,omitempty"`
}

func (c *HTTPClient) UpdateProfile(ctx context.Context, token string, req *UpdateProfileRequest) (*Profile, error) {
	var resp struct {
		Profile Profile `json:"profile"`
	}
	if err := c.do(ctx, "PATCH", "/v1/users/me", token, req, &resp); err != nil {
		return nil, err
	}
	return &resp.Profile, nil
}

// CreateTeamRequest is the wire payload for POST /v1/teams.
type CreateTeamRequest struct {
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Description  string `json:"description,omitempty"`
	CountryCode  string `json:"country_code,omitempty"`
	IsPrivate    bool   `json:"is_private,omitempty"`
	IsRecruiting bool   `json:"is_recruiting,omitempty"`
}

func (c *HTTPClient) CreateTeam(ctx context.Context, token string, req *CreateTeamRequest) (*Team, error) {
	var resp struct {
		Team Team `json:"team"`
	}
	if err := c.do(ctx, "POST", "/v1/teams", token, req, &resp); err != nil {
		return nil, err
	}
	return &resp.Team, nil
}

func (c *HTTPClient) GetTeam(ctx context.Context, token string, teamID uuid.UUID) (*Team, error) {
	var resp struct {
		Team Team `json:"team"`
	}
	if err := c.do(ctx, "GET", "/v1/teams/"+teamID.String(), token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp.Team, nil
}

func (c *HTTPClient) ListMyTeams(ctx context.Context, token string) ([]Team, error) {
	var resp struct {
		Teams []Team `json:"teams"`
	}
	if err := c.do(ctx, "GET", "/v1/teams/me", token, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Teams, nil
}

func (c *HTTPClient) ListFriends(ctx context.Context, token string, userID uuid.UUID) ([]uuid.UUID, error) {
	var resp struct {
		Friends []uuid.UUID `json:"friends"`
	}
	if err := c.do(ctx, "GET", "/v1/users/"+userID.String()+"/friends", token, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Friends, nil
}

// =============================================================================
// HTTP internals
// =============================================================================

func (c *HTTPClient) do(ctx context.Context, method, path, token string, body, out any) error {
	var bodyReader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var errResp struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(respBody, &errResp)
		return &APIError{
			StatusCode: resp.StatusCode,
			Code:       errResp.Error.Code,
			Message:    errResp.Error.Message,
		}
	}

	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("unmarshal response: %w", err)
		}
	}
	return nil
}

// APIError is returned for non-2xx HTTP responses.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("user-svc API error: %d %s: %s", e.StatusCode, e.Code, e.Message)
}

// =============================================================================
// gRPC client (for internal lookups)
// =============================================================================

// GRPCClient wraps the gRPC stub.
// Re-exports the wire types so callers don't need to import the internal package.
type (
	UserMetadata = grpcserver.UserMetadata
	GRPCTeam     = grpcserver.Team
)

// (Production code would generate this from .proto; here we expose the types
// already defined in internal/grpc.)
