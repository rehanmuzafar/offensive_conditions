//go:build integration

// Package integration runs end-to-end tests against the real user-svc HTTP API.
//
// Prerequisites:
//   - Postgres reachable at $DB_HOST with migrations applied
//   - Redis reachable at $REDIS_ADDR
//   - MinIO reachable at $STORAGE_ENDPOINT
//   - user-svc server running and reachable at $USER_SVC_URL
//   - A valid JWT for two test users in $TEST_TOKEN_ALICE and $TEST_TOKEN_BOB
//
// Run: make test-integration
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const (
	envBaseURL    = "USER_SVC_URL"
	envTokenAlice = "TEST_TOKEN_ALICE"
	envTokenBob   = "TEST_TOKEN_BOB"
	envAliceID    = "TEST_USER_ID_ALICE"
	envBobID      = "TEST_USER_ID_BOB"
)

func mustEnv(t *testing.T, key string) string {
	v := os.Getenv(key)
	if v == "" {
		t.Skipf("integration test requires %s env var", key)
	}
	return v
}

func TestProfileLifecycle(t *testing.T) {
	baseURL := mustEnv(t, envBaseURL)
	token := mustEnv(t, envTokenAlice)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	c := &client{baseURL: baseURL, token: token, t: t, ctx: ctx}

	// Get current profile
	var me struct {
		Profile struct {
			UserID   uuid.UUID `json:"user_id"`
			Username string    `json:"username"`
		} `json:"profile"`
	}
	c.do("GET", "/v1/users/me", nil, &me)
	require.NotZero(t, me.Profile.UserID)
	require.NotEmpty(t, me.Profile.Username)

	// Update bio
	bio := fmt.Sprintf("integration test bio %d", time.Now().Unix())
	c.do("PATCH", "/v1/users/me", map[string]any{"bio": bio}, nil)

	// Re-read and confirm
	var after struct {
		Profile struct {
			Bio string `json:"bio"`
		} `json:"profile"`
	}
	c.do("GET", "/v1/users/me", nil, &after)
	require.Equal(t, bio, after.Profile.Bio)
}

func TestFriendRequestFlow(t *testing.T) {
	baseURL := mustEnv(t, envBaseURL)
	aliceTok := mustEnv(t, envTokenAlice)
	bobTok := mustEnv(t, envTokenBob)
	bobID := mustEnv(t, envBobID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	alice := &client{baseURL: baseURL, token: aliceTok, t: t, ctx: ctx}
	bob := &client{baseURL: baseURL, token: bobTok, t: t, ctx: ctx}

	// Alice sends a request to Bob
	var sent struct {
		Request struct {
			ID uuid.UUID `json:"id"`
		} `json:"request"`
	}
	alice.do("POST", "/v1/friends/requests",
		map[string]any{"receiver_id": bobID, "message": "hi from alice"}, &sent)
	require.NotZero(t, sent.Request.ID)

	// Bob accepts
	bob.do("POST", fmt.Sprintf("/v1/friends/requests/%s/accept", sent.Request.ID), nil, nil)

	// Verify Bob now appears in Alice's friends list
	var aliceFriends struct {
		Friends []uuid.UUID `json:"friends"`
	}
	var aliceMe struct {
		Profile struct {
			UserID uuid.UUID `json:"user_id"`
		} `json:"profile"`
	}
	alice.do("GET", "/v1/users/me", nil, &aliceMe)
	alice.do("GET", fmt.Sprintf("/v1/users/%s/friends", aliceMe.Profile.UserID), nil, &aliceFriends)

	bobUUID := uuid.MustParse(bobID)
	found := false
	for _, f := range aliceFriends.Friends {
		if f == bobUUID {
			found = true
			break
		}
	}
	require.True(t, found, "bob should appear in alice's friends list after acceptance")
}

func TestTeamCreateAndInvite(t *testing.T) {
	baseURL := mustEnv(t, envBaseURL)
	aliceTok := mustEnv(t, envTokenAlice)
	bobTok := mustEnv(t, envTokenBob)
	bobID := mustEnv(t, envBobID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	alice := &client{baseURL: baseURL, token: aliceTok, t: t, ctx: ctx}
	bob := &client{baseURL: baseURL, token: bobTok, t: t, ctx: ctx}

	slug := fmt.Sprintf("int-team-%d", time.Now().Unix())
	var created struct {
		Team struct {
			ID uuid.UUID `json:"id"`
		} `json:"team"`
	}
	alice.do("POST", "/v1/teams", map[string]any{
		"name":         "Integration Team",
		"slug":         slug,
		"is_recruiting": true,
	}, &created)
	require.NotZero(t, created.Team.ID)

	// Alice invites Bob
	var inv struct {
		Invitation struct {
			ID uuid.UUID `json:"id"`
		} `json:"invitation"`
	}
	alice.do("POST", fmt.Sprintf("/v1/teams/%s/invitations", created.Team.ID),
		map[string]any{"invitee_id": bobID}, &inv)
	require.NotZero(t, inv.Invitation.ID)

	// Bob accepts
	bob.do("POST", fmt.Sprintf("/v1/teams/invitations/%s/accept", inv.Invitation.ID), nil, nil)

	// Team should now have 2 members
	var team struct {
		Team struct {
			MemberCount int `json:"member_count"`
		} `json:"team"`
	}
	alice.do("GET", fmt.Sprintf("/v1/teams/%s", created.Team.ID), nil, &team)
	require.Equal(t, 2, team.Team.MemberCount)
}

func TestBlockPreventsRequest(t *testing.T) {
	baseURL := mustEnv(t, envBaseURL)
	aliceTok := mustEnv(t, envTokenAlice)
	bobTok := mustEnv(t, envTokenBob)
	aliceID := mustEnv(t, envAliceID)
	bobID := mustEnv(t, envBobID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	alice := &client{baseURL: baseURL, token: aliceTok, t: t, ctx: ctx}
	bob := &client{baseURL: baseURL, token: bobTok, t: t, ctx: ctx}

	// Alice blocks Bob
	alice.do("POST", fmt.Sprintf("/v1/users/%s/block", bobID),
		map[string]any{"reason": "test"}, nil)

	// Bob can't send a friend request now
	resp, body, err := bob.raw("POST", "/v1/friends/requests",
		map[string]any{"receiver_id": aliceID})
	require.NoError(t, err)
	require.NotEqual(t, http.StatusCreated, resp.StatusCode,
		"expected friend request to be rejected (body: %s)", string(body))

	// Cleanup
	alice.do("DELETE", fmt.Sprintf("/v1/users/%s/block", bobID), nil, nil)
}

// =============================================================================
// HTTP client wrapper
// =============================================================================

type client struct {
	baseURL string
	token   string
	t       *testing.T
	ctx     context.Context
}

func (c *client) do(method, path string, body any, out any) {
	resp, respBody, err := c.raw(method, path, body)
	require.NoErrorf(c.t, err, "request %s %s failed", method, path)
	if resp.StatusCode >= 400 {
		c.t.Fatalf("%s %s returned %d: %s", method, path, resp.StatusCode, string(respBody))
	}
	if out != nil && len(respBody) > 0 {
		require.NoError(c.t, json.Unmarshal(respBody, out))
	}
}

func (c *client) raw(method, path string, body any) (*http.Response, []byte, error) {
	var bodyReader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		bodyReader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(c.ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b, nil
}
