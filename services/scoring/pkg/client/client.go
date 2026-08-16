// Package client is a Go SDK for the scoring service.
//
// Other services use this to query scores and leaderboards without
// needing to know HTTP details.
package client

import (
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
	authToken  string // optional service-to-service token
}

type Option func(*Client)

func WithHTTPClient(c *http.Client) Option {
	return func(cl *Client) { cl.httpClient = c }
}

func WithAuthToken(token string) Option {
	return func(cl *Client) { cl.authToken = token }
}

func WithTimeout(d time.Duration) Option {
	return func(cl *Client) { cl.httpClient.Timeout = d }
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

type Profile struct {
	UserID            string `json:"user_id"`
	TotalPoints       int64  `json:"total_points"`
	MachinePoints     int64  `json:"machine_points"`
	ChallengePoints   int64  `json:"challenge_points"`
	CTFPoints         int64  `json:"ctf_points"`
	BonusPoints       int64  `json:"bonus_points"`
	MachinesOwned     int    `json:"machines_owned"`
	ChallengesSolved  int    `json:"challenges_solved"`
	FirstBloods       int    `json:"first_bloods"`
	GlobalRank        int    `json:"global_rank,omitempty"`
	CountryCode       string `json:"country_code,omitempty"`
	RankTier          string `json:"rank_tier,omitempty"`
	RankTierName      string `json:"rank_tier_name,omitempty"`
	CurrentStreak     int    `json:"current_streak_days"`
	LongestStreak     int    `json:"longest_streak_days"`
	ELO               *ELO   `json:"elo,omitempty"`
	AchievementsCount int    `json:"achievements_count"`
}

type ELO struct {
	Rating        int  `json:"rating"`
	PeakRating    int  `json:"peak_rating"`
	MatchesPlayed int  `json:"matches_played"`
	Wins          int  `json:"wins"`
	Losses        int  `json:"losses"`
	Draws         int  `json:"draws"`
	IsProvisional bool `json:"is_provisional"`
}

type LeaderboardEntry struct {
	Rank   int    `json:"rank"`
	UserID string `json:"user_id"`
	Score  int64  `json:"score"`
}

type LeaderboardResponse struct {
	Scope    string             `json:"scope"`
	Entries  []LeaderboardEntry `json:"entries"`
	Limit    int                `json:"limit,omitempty"`
	Offset   int                `json:"offset,omitempty"`
	SeasonID string             `json:"season_id,omitempty"`
	Country  string             `json:"country,omitempty"`
	Category string             `json:"category,omitempty"`
}

type Season struct {
	ID                string    `json:"id"`
	Code              string    `json:"code"`
	Name              string    `json:"name"`
	StartsAt          time.Time `json:"starts_at"`
	EndsAt            time.Time `json:"ends_at"`
	State             string    `json:"state"`
	CarryoverFraction float64   `json:"carryover_fraction"`
}

type CurrentSeasonResponse struct {
	Season      Season `json:"season"`
	YourRank    int    `json:"your_rank,omitempty"`
	YourPoints  int64  `json:"your_points,omitempty"`
}

// =============================================================================
// Methods
// =============================================================================

func (c *Client) GetProfile(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	var p Profile
	if err := c.get(ctx, fmt.Sprintf("/v1/profile/%s", userID), nil, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) GetMyProfile(ctx context.Context) (*Profile, error) {
	var p Profile
	if err := c.get(ctx, "/v1/profile/me", nil, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) GetGlobalLeaderboard(ctx context.Context, limit, offset int) (*LeaderboardResponse, error) {
	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	var r LeaderboardResponse
	if err := c.get(ctx, "/v1/leaderboard/global", q, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) GetSeasonLeaderboard(ctx context.Context, seasonID uuid.UUID, limit, offset int) (*LeaderboardResponse, error) {
	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	var r LeaderboardResponse
	if err := c.get(ctx, fmt.Sprintf("/v1/leaderboard/season/%s", seasonID), q, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) GetCountryLeaderboard(ctx context.Context, iso string, limit, offset int) (*LeaderboardResponse, error) {
	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	var r LeaderboardResponse
	if err := c.get(ctx, fmt.Sprintf("/v1/leaderboard/country/%s", iso), q, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) GetCurrentSeason(ctx context.Context) (*CurrentSeasonResponse, error) {
	var r CurrentSeasonResponse
	if err := c.get(ctx, "/v1/seasons/current", nil, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// =============================================================================
// Internal
// =============================================================================

func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	u := c.baseURL + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &Error{
			Status:  resp.StatusCode,
			Message: fmt.Sprintf("%s %s: %s", req.Method, path, string(body)),
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }
