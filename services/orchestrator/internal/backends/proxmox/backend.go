// Package proxmox implements the Backend interface against Proxmox VE.
//
// Proxmox is used for VM-based labs (Windows machines, AD environments,
// kernel exploitation challenges) where container isolation is insufficient.
//
// Workflow:
//   1. Clone a pre-built VM template (e.g. windows-server-2022)
//   2. Configure VM: VLAN, MAC, cloud-init data with flag injection
//   3. Start VM
//   4. Wait for QEMU guest agent to report IP
package proxmox

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/offensive-conditions/orchestrator/internal/backends"
)

type Backend struct {
	endpoint     string
	tokenID      string
	tokenSecret  string
	defaultNode  string
	storage      string
	bridge       string
	client       *http.Client
}

type Options struct {
	Endpoint    string
	TokenID     string
	TokenSecret string
	DefaultNode string
	Storage     string
	Bridge      string
	VerifyTLS   bool
	Timeout     time.Duration
}

func New(opts Options) (*Backend, error) {
	if opts.Endpoint == "" {
		return nil, fmt.Errorf("endpoint required")
	}
	if opts.TokenID == "" || opts.TokenSecret == "" {
		return nil, fmt.Errorf("API token required")
	}
	if opts.Timeout == 0 {
		opts.Timeout = 30 * time.Second
	}
	tr := &http.Transport{}
	if !opts.VerifyTLS {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Backend{
		endpoint:    strings.TrimRight(opts.Endpoint, "/"),
		tokenID:     opts.TokenID,
		tokenSecret: opts.TokenSecret,
		defaultNode: opts.DefaultNode,
		storage:     opts.Storage,
		bridge:      opts.Bridge,
		client:      &http.Client{Transport: tr, Timeout: opts.Timeout},
	}, nil
}

func (b *Backend) Name() string { return "proxmox" }

// Spawn clones a VM template and starts it.
//
// req.Image must be the template VMID (numeric, as string) or "node:vmid".
func (b *Backend) Spawn(ctx context.Context, req backends.SpawnRequest) (*backends.SpawnResult, error) {
	node, templateVMID, err := parseTemplate(b.defaultNode, req.Image)
	if err != nil {
		return nil, err
	}

	// 1. Allocate a new VMID
	newVMID, err := b.nextVMID(ctx)
	if err != nil {
		return nil, fmt.Errorf("alloc vmid: %w", err)
	}

	// 2. Clone template → new VM
	cloneForm := url.Values{}
	cloneForm.Set("newid", strconv.Itoa(newVMID))
	cloneForm.Set("name", fmt.Sprintf("lab-%s", req.InstanceID.String()[:8]))
	cloneForm.Set("full", "1") // full clone (independent disk)
	cloneForm.Set("storage", b.storage)

	cloneTaskID, err := b.postTask(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/clone", node, templateVMID), cloneForm)
	if err != nil {
		return nil, fmt.Errorf("clone template: %w", err)
	}
	if err := b.waitTask(ctx, node, cloneTaskID, 5*time.Minute); err != nil {
		return nil, fmt.Errorf("clone task: %w", err)
	}

	// 3. Configure: cloud-init user data (with flag injection), network bridge
	confForm := url.Values{}
	confForm.Set("net0", fmt.Sprintf("virtio,bridge=%s,firewall=1", b.bridge))
	if req.InstanceIP != "" {
		// Static IP via cloud-init
		confForm.Set("ipconfig0", fmt.Sprintf("ip=%s/%d,gw=%s",
			req.InstanceIP, prefixSizeFromCIDR(req.NetworkCIDR), req.GatewayIP))
	}
	if userData := buildCloudInit(req); userData != "" {
		confForm.Set("ciuser", "labuser")
		confForm.Set("cipassword", "lab-pass-rotate-me")
		// In production we'd upload cicustom snippets; this is the basic form
	}
	if _, err := b.put(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/config", node, newVMID), confForm); err != nil {
		_ = b.Teardown(ctx, fmt.Sprintf("%s:%d", node, newVMID))
		return nil, fmt.Errorf("configure vm: %w", err)
	}

	// 4. Start
	if _, err := b.postTask(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/status/start", node, newVMID), nil); err != nil {
		_ = b.Teardown(ctx, fmt.Sprintf("%s:%d", node, newVMID))
		return nil, fmt.Errorf("start vm: %w", err)
	}

	return &backends.SpawnResult{
		Ref:      fmt.Sprintf("%s:%d", node, newVMID),
		NodeName: node,
	}, nil
}

func (b *Backend) Status(ctx context.Context, ref string) (*backends.Status, error) {
	node, vmid, err := parseRef(ref)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Status   string  `json:"status"`
			QMPStatus string `json:"qmpstatus"`
			Uptime   int64   `json:"uptime"`
		} `json:"data"`
	}
	if err := b.get(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/status/current", node, vmid), &resp); err != nil {
		if isNotFound(err) {
			return &backends.Status{Phase: backends.PhaseGone}, nil
		}
		return nil, err
	}

	st := &backends.Status{NodeName: node}
	switch resp.Data.Status {
	case "running":
		st.Phase = backends.PhaseRunning
		st.Ready = resp.Data.Uptime > 30 // give cloud-init time
		// Best-effort IP fetch via guest agent
		st.IPAddress, _ = b.guestAgentIP(ctx, node, vmid)
	case "stopped":
		st.Phase = backends.PhaseFailed
		st.Reason = "vm stopped"
	default:
		st.Phase = backends.PhasePending
		st.Reason = resp.Data.Status
	}
	return st, nil
}

func (b *Backend) guestAgentIP(ctx context.Context, node string, vmid int) (string, error) {
	var resp struct {
		Data struct {
			Result []struct {
				IPAddresses []struct {
					IPAddress string `json:"ip-address"`
					IPAddressType string `json:"ip-address-type"`
				} `json:"ip-addresses"`
				Name string `json:"name"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := b.get(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/agent/network-get-interfaces", node, vmid), &resp); err != nil {
		return "", err
	}
	for _, iface := range resp.Data.Result {
		if iface.Name == "lo" || strings.HasPrefix(iface.Name, "Loopback") {
			continue
		}
		for _, a := range iface.IPAddresses {
			if a.IPAddressType == "ipv4" && !strings.HasPrefix(a.IPAddress, "127.") {
				return a.IPAddress, nil
			}
		}
	}
	return "", nil
}

func (b *Backend) Teardown(ctx context.Context, ref string) error {
	node, vmid, err := parseRef(ref)
	if err != nil {
		return err
	}
	// Stop first (force-shutdown after 60s)
	stopForm := url.Values{}
	stopForm.Set("timeout", "60")
	_, _ = b.postTask(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/status/shutdown", node, vmid), stopForm)

	// Wait briefly then force-destroy
	time.Sleep(2 * time.Second)
	destroyForm := url.Values{}
	destroyForm.Set("purge", "1")
	destroyForm.Set("destroy-unreferenced-disks", "1")
	_, err = b.deleteWithForm(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d", node, vmid), destroyForm)
	if err != nil && !isNotFound(err) {
		return fmt.Errorf("destroy vm: %w", err)
	}
	return nil
}

// Reset for Proxmox = revert to template snapshot.
// Requires the template to have a snapshot named "clean".
func (b *Backend) Reset(ctx context.Context, ref string) error {
	node, vmid, err := parseRef(ref)
	if err != nil {
		return err
	}
	_, err = b.postTask(ctx,
		fmt.Sprintf("/nodes/%s/qemu/%d/snapshot/clean/rollback", node, vmid), nil)
	return err
}

// Logs returns the QEMU serial console output (last N lines).
func (b *Backend) Logs(ctx context.Context, ref string, tailLines int) ([]string, error) {
	// Proxmox doesn't expose container-style logs; we'd need to integrate
	// with the VM's serial console which is complex. Stub for now.
	return []string{"[proxmox] VM logs available via serial console only"}, nil
}

// =============================================================================
// HTTP helpers
// =============================================================================

func (b *Backend) authHeader() string {
	return fmt.Sprintf("PVEAPIToken=%s=%s", b.tokenID, b.tokenSecret)
}

func (b *Backend) get(ctx context.Context, path string, out any) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", b.endpoint+path, nil)
	req.Header.Set("Authorization", b.authHeader())
	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return &httpError{status: resp.StatusCode, body: string(body)}
	}
	if out != nil {
		return json.Unmarshal(body, out)
	}
	return nil
}

// postTask performs a POST that returns a Proxmox task ID (UPID) for async ops.
func (b *Backend) postTask(ctx context.Context, path string, form url.Values) (string, error) {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", b.endpoint+path, body)
	req.Header.Set("Authorization", b.authHeader())
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", &httpError{status: resp.StatusCode, body: string(rb)}
	}
	var out struct {
		Data string `json:"data"`
	}
	_ = json.Unmarshal(rb, &out)
	return out.Data, nil
}

func (b *Backend) put(ctx context.Context, path string, form url.Values) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, "PUT", b.endpoint+path, strings.NewReader(form.Encode()))
	req.Header.Set("Authorization", b.authHeader())
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, &httpError{status: resp.StatusCode, body: string(rb)}
	}
	return rb, nil
}

func (b *Backend) deleteWithForm(ctx context.Context, path string, form url.Values) ([]byte, error) {
	full := b.endpoint + path
	if len(form) > 0 {
		full += "?" + form.Encode()
	}
	req, _ := http.NewRequestWithContext(ctx, "DELETE", full, nil)
	req.Header.Set("Authorization", b.authHeader())
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, &httpError{status: resp.StatusCode, body: string(rb)}
	}
	return rb, nil
}

// nextVMID asks Proxmox for the next available VMID.
func (b *Backend) nextVMID(ctx context.Context) (int, error) {
	var resp struct {
		Data string `json:"data"`
	}
	if err := b.get(ctx, "/cluster/nextid", &resp); err != nil {
		return 0, err
	}
	return strconv.Atoi(resp.Data)
}

// waitTask polls a Proxmox task until completion or timeout.
func (b *Backend) waitTask(ctx context.Context, node, upid string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var resp struct {
			Data struct {
				Status     string `json:"status"`
				ExitStatus string `json:"exitstatus"`
			} `json:"data"`
		}
		err := b.get(ctx,
			fmt.Sprintf("/nodes/%s/tasks/%s/status", node, url.QueryEscape(upid)), &resp)
		if err != nil {
			return err
		}
		if resp.Data.Status == "stopped" {
			if resp.Data.ExitStatus == "OK" {
				return nil
			}
			return fmt.Errorf("task failed: %s", resp.Data.ExitStatus)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("task timeout")
}

// =============================================================================
// Helpers
// =============================================================================

func parseTemplate(defaultNode, image string) (node string, vmid int, err error) {
	if strings.Contains(image, ":") {
		parts := strings.SplitN(image, ":", 2)
		node = parts[0]
		vmid, err = strconv.Atoi(parts[1])
		return
	}
	vmid, err = strconv.Atoi(image)
	node = defaultNode
	return
}

func parseRef(ref string) (node string, vmid int, err error) {
	parts := strings.SplitN(ref, ":", 2)
	if len(parts) != 2 {
		return "", 0, fmt.Errorf("invalid ref: %s", ref)
	}
	node = parts[0]
	vmid, err = strconv.Atoi(parts[1])
	return
}

func prefixSizeFromCIDR(cidr string) int {
	if idx := strings.LastIndex(cidr, "/"); idx > 0 {
		n, _ := strconv.Atoi(cidr[idx+1:])
		return n
	}
	return 30
}

func buildCloudInit(req backends.SpawnRequest) string {
	// Cloud-init user-data with flag injection.
	// Full implementation would generate cloud-init YAML, upload as snippet,
	// and reference via cicustom config. Stub returns a marker.
	if len(req.EnvVars) > 0 {
		var buf bytes.Buffer
		buf.WriteString("#cloud-config\n")
		for k, v := range req.EnvVars {
			fmt.Fprintf(&buf, "# %s=%s\n", k, v)
		}
		return buf.String()
	}
	return ""
}

type httpError struct {
	status int
	body   string
}

func (e *httpError) Error() string {
	return fmt.Sprintf("proxmox http %d: %s", e.status, e.body)
}

func isNotFound(err error) bool {
	he, ok := err.(*httpError)
	return ok && he.status == 404
}
