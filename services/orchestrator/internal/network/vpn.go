package network

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// VPNController programs the user-facing VPN gateway with per-instance routes.
//
// Production setup: a WireGuard server fronts user connections. When an instance
// spawns, we POST a route to the WG controller saying "user U's tunnel can reach IP X".
// When the instance dies, we DELETE that route.
//
// This package targets a simple JSON REST API (the WireGuard controller is a
// separate small Go service we'd run alongside; in dev we can stub it).
type VPNController struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

func NewVPNController(endpoint, apiKey string) *VPNController {
	return &VPNController{
		endpoint: endpoint,
		apiKey:   apiKey,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// AddRoute tells the VPN gateway: "user U can reach IP X (via the instance subnet)".
// Idempotent — re-adding the same route is OK.
func (v *VPNController) AddRoute(ctx context.Context, userID, instanceID, instanceCIDR string) error {
	if v.endpoint == "" {
		// Dev mode — no VPN controller wired
		return nil
	}
	body := map[string]any{
		"user_id":     userID,
		"instance_id": instanceID,
		"cidr":        instanceCIDR,
	}
	return v.post(ctx, "/v1/routes", body)
}

// RemoveRoute tears down a previously-added route.
func (v *VPNController) RemoveRoute(ctx context.Context, instanceID string) error {
	if v.endpoint == "" {
		return nil
	}
	return v.delete(ctx, "/v1/routes/"+instanceID)
}

// EnsureUserPeer makes sure the user has a WG peer entry on the gateway.
// Returns the user's tunnel IP (in the VPN subnet) and config.
func (v *VPNController) EnsureUserPeer(ctx context.Context, userID, publicKey string) (tunnelIP string, err error) {
	if v.endpoint == "" {
		return "10.200.0.2/32", nil // dev stub
	}
	body := map[string]any{
		"user_id":    userID,
		"public_key": publicKey,
	}
	resp, err := v.postWithResponse(ctx, "/v1/peers", body)
	if err != nil {
		return "", err
	}
	var out struct {
		TunnelIP string `json:"tunnel_ip"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return "", fmt.Errorf("decode peer response: %w", err)
	}
	return out.TunnelIP, nil
}

func (v *VPNController) post(ctx context.Context, path string, body any) error {
	_, err := v.postWithResponse(ctx, path, body)
	return err
}

func (v *VPNController) postWithResponse(ctx context.Context, path string, body any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", v.endpoint+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if v.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+v.apiKey)
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vpn controller post: %w", err)
	}
	defer resp.Body.Close()

	respBody := readAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("vpn controller %s %d: %s", path, resp.StatusCode, respBody)
	}
	return respBody, nil
}

func (v *VPNController) delete(ctx context.Context, path string) error {
	req, err := http.NewRequestWithContext(ctx, "DELETE", v.endpoint+path, nil)
	if err != nil {
		return err
	}
	if v.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+v.apiKey)
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("vpn controller delete: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("vpn controller %s %d", path, resp.StatusCode)
	}
	return nil
}

func readAll(r interface{ Read(p []byte) (int, error) }) []byte {
	var buf bytes.Buffer
	tmp := make([]byte, 4096)
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
		}
		if err != nil {
			break
		}
	}
	return buf.Bytes()
}
