// Package client is a Go SDK for the flag-verifier service.
//
// Most callers will be the frontend (via HTTP directly), but other backend
// services (like CTF) can use this client to submit flags on behalf of users.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
	authToken  string
}

type Option func(*Client)

func WithHTTPClient(c *http.Client) Option {
	return func(cl *Client) { cl.httpClient = c }
}

func WithAuthToken(token string) Option {
	return func(cl *Client) { cl.authToken = token }
}

func New(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// =============================================================================
// Types
// =============================================================================

type SubmitRequest struct {
	Flag        string     `json:"flag"`
	ContentType string     `json:"content_type"`
	ContentID   uuid.UUID  `json:"content_id"`
	InstanceID  *uuid.UUID `json:"instance_id,omitempty"`
}

type SubmitResponse struct {
	Accepted        bool      `json:"accepted"`
	SubmissionID    uuid.UUID `json:"submission_id"`
	FlagType        string    `json:"flag_type,omitempty"`
	IsFirstBlood    bool      `json:"is_first_blood"`
	BloodRank       int       `json:"blood_rank,omitempty"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	SecondsToSolve  int       `json:"seconds_to_solve,omitempty"`
	Message         string    `json:"message,omitempty"`
	FromCache       bool      `json:"from_cache,omitempty"`
	SubmittedAt     time.Time `json:"submitted_at"`
}

type HistoryItem struct {
	ID              uuid.UUID `json:"id"`
	ContentType     string    `json:"content_type"`
	ContentID       uuid.UUID `json:"content_id"`
	FlagType        string    `json:"flag_type,omitempty"`
	Accepted        bool      `json:"accepted"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	IsFirstBlood    bool      `json:"is_first_blood"`
	BloodRank       int       `json:"blood_rank,omitempty"`
	SubmittedAt     time.Time `json:"submitted_at"`
}

type HistoryResponse struct {
	Submissions []HistoryItem `json:"submissions"`
	Limit       int           `json:"limit"`
	Offset      int           `json:"offset"`
}

// =============================================================================
// Methods
// =============================================================================

func (c *Client) Submit(ctx context.Context, req SubmitRequest) (*SubmitResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	var out SubmitResponse
	if err := c.do(ctx, http.MethodPost, "/v1/flags/submit", nil, bytes.NewReader(body), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) History(ctx context.Context, limit, offset int) (*HistoryResponse, error) {
	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	var out HistoryResponse
	if err := c.do(ctx, http.MethodGet, "/v1/flags/history", q, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// =============================================================================
// Internal
// =============================================================================

func (c *Client) do(ctx context.Context, method, path string, q url.Values, body io.Reader, out any) error {
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return err
	}
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &Error{
			Status:           resp.StatusCode,
			Body:             string(buf),
			RetryAfterSeconds: parseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type Error struct {
	Status            int
	Body              string
	RetryAfterSeconds int
}

func (e *Error) Error() string {
	return fmt.Sprintf("flag-verifier %d: %s", e.Status, e.Body)
}

func (e *Error) IsRateLimit() bool { return e.Status == http.StatusTooManyRequests }

func parseRetryAfter(s string) int {
	if s == "" {
		return 0
	}
	n, _ := strconv.Atoi(s)
	return n
}
