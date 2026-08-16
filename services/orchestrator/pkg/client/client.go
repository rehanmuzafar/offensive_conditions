// Package client is a Go SDK for the Lab Orchestrator HTTP API.
//
// Other services (scoring, notification, CTF, content) use this client to call
// the orchestrator. Frontend uses the HTTP API directly.
//
// Usage:
//
//	c := client.New("https://orchestrator.offcon.svc:8002", client.WithAuthToken(token))
//	out, err := c.Spawn(ctx, client.SpawnRequest{MachineSlug: "lame"})
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// Client wraps the orchestrator's HTTP API.
type Client struct {
	baseURL    string
	httpClient *http.Client
	authToken  string
	apiKey     string // service-to-service auth (alternate)
}

// Option configures the Client.
type Option func(*Client)

func WithHTTPClient(c *http.Client) Option { return func(cl *Client) { cl.httpClient = c } }
func WithAuthToken(token string) Option    { return func(cl *Client) { cl.authToken = token } }
func WithAPIKey(key string) Option         { return func(cl *Client) { cl.apiKey = key } }
func WithTimeout(d time.Duration) Option {
	return func(cl *Client) {
		if cl.httpClient == nil {
			cl.httpClient = &http.Client{}
		}
		cl.httpClient.Timeout = d
	}
}

// New creates a new orchestrator client.
func New(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// =============================================================================
// Spawn
// =============================================================================

type SpawnRequest struct {
	MachineSlug string `json:"machine_slug"`
	TTLSeconds  int    `json:"ttl_seconds,omitempty"`
}

type SpawnResponse struct {
	InstanceID string    `json:"instance_id"`
	State      string    `json:"state"`
	ExpiresAt  time.Time `json:"expires_at"`
	IPAddress  string    `json:"ip_address,omitempty"`
	Subnet     string    `json:"subnet,omitempty"`
}

func (c *Client) Spawn(ctx context.Context, req SpawnRequest) (*SpawnResponse, error) {
	var resp SpawnResponse
	if err := c.do(ctx, "POST", "/v1/instances", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// =============================================================================
// Get / List
// =============================================================================

type InstanceResponse struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	MachineID      string     `json:"machine_id"`
	MachineSlug    string     `json:"machine_slug"`
	Backend        string     `json:"backend"`
	State          string     `json:"state"`
	IPAddress      string     `json:"ip_address,omitempty"`
	Subnet         string     `json:"subnet,omitempty"`
	HealthStatus   string     `json:"health_status,omitempty"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	ExpiresAt      time.Time  `json:"expires_at"`
	ExtensionsUsed int        `json:"extensions_used"`
	FailureReason  string     `json:"failure_reason,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (c *Client) GetInstance(ctx context.Context, instanceID string) (*InstanceResponse, error) {
	var resp InstanceResponse
	if err := c.do(ctx, "GET", "/v1/instances/"+instanceID, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ListActiveInstances(ctx context.Context) ([]InstanceResponse, error) {
	var wrapper struct {
		Instances []InstanceResponse `json:"instances"`
	}
	if err := c.do(ctx, "GET", "/v1/instances/active", nil, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Instances, nil
}

// =============================================================================
// Terminate / Extend / Reset / Logs
// =============================================================================

func (c *Client) Terminate(ctx context.Context, instanceID string) error {
	return c.do(ctx, "DELETE", "/v1/instances/"+instanceID, nil, nil)
}

type ExtendResponse struct {
	ExpiresAt time.Time `json:"expires_at"`
}

func (c *Client) Extend(ctx context.Context, instanceID string) (*ExtendResponse, error) {
	var resp ExtendResponse
	if err := c.do(ctx, "POST", "/v1/instances/"+instanceID+"/extend", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) Reset(ctx context.Context, instanceID string) error {
	return c.do(ctx, "POST", "/v1/instances/"+instanceID+"/reset", nil, nil)
}

func (c *Client) Logs(ctx context.Context, instanceID string, tailLines int) ([]string, error) {
	path := "/v1/instances/" + instanceID + "/logs"
	if tailLines > 0 {
		path += "?tail=" + strconv.Itoa(tailLines)
	}
	var wrapper struct {
		Lines []string `json:"lines"`
	}
	if err := c.do(ctx, "GET", path, nil, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Lines, nil
}

// =============================================================================
// Submit Flag
// =============================================================================

type FlagSubmitRequest struct {
	MachineSlug string  `json:"machine_slug"`
	InstanceID  *string `json:"instance_id,omitempty"`
	FlagType    string  `json:"flag_type"` // "user" | "root"
	Flag        string  `json:"flag"`
}

type FlagSubmitResponse struct {
	Correct       bool `json:"correct"`
	AlreadySolved bool `json:"already_solved"`
	PointsAwarded int  `json:"points_awarded"`
}

func (c *Client) SubmitFlag(ctx context.Context, req FlagSubmitRequest) (*FlagSubmitResponse, error) {
	var resp FlagSubmitResponse
	if err := c.do(ctx, "POST", "/v1/flags/submit", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// =============================================================================
// HTTP helper
// =============================================================================

type APIError struct {
	StatusCode int            `json:"-"`
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	Details    map[string]any `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("orchestrator API %d %s: %s", e.StatusCode, e.Code, e.Message)
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	if c.apiKey != "" {
		req.Header.Set("X-API-Key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	rb, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode >= 400 {
		var wrap struct {
			Error APIError `json:"error"`
		}
		if json.Unmarshal(rb, &wrap) == nil && wrap.Error.Code != "" {
			wrap.Error.StatusCode = resp.StatusCode
			return &wrap.Error
		}
		return &APIError{
			StatusCode: resp.StatusCode,
			Code:       "HTTP_" + strconv.Itoa(resp.StatusCode),
			Message:    string(rb),
		}
	}

	if out != nil && len(rb) > 0 {
		if err := json.Unmarshal(rb, out); err != nil {
			return fmt.Errorf("unmarshal: %w", err)
		}
	}
	return nil
}
