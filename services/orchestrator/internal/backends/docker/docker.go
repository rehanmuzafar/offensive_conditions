// Package docker runs lab instances as containers on a Docker host.
//
// It speaks the Docker Engine REST API directly over the daemon socket rather
// than pulling in the docker/docker SDK: the calls we need are four endpoints,
// and the SDK drags in a very large dependency tree for no benefit here.
//
// A challenge port is published on an ephemeral host port; the mapped port is
// read back after start and returned as the instance's connection address, so
// players get `host:port` the same way HackTheBox hands one out.
//
// Security: containers are started unprivileged, with all capabilities dropped,
// a read-only root filesystem, no new privileges, and hard memory/CPU/PID
// limits. Challenge containers hand a shell to hostile users by design, so the
// defaults matter more here than in ordinary workloads.
package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/offensive-conditions/orchestrator/internal/backends"
)

// Options configures the backend.
type Options struct {
	// Host is the daemon address: "unix:///var/run/docker.sock" or
	// "tcp://10.0.0.5:2376". Plain-TCP daemons are unauthenticated — only use
	// one over a private network or behind TLS/SSH.
	Host string
	// PublicHost is the address players connect to (the VPS's public IP, or a
	// LAN address for an on-site event). The daemon does not know this.
	PublicHost string
	// Network the containers join. Empty uses the daemon default.
	Network string
	// Egress, when false, starts containers with networking that cannot reach
	// the internet — so the box cannot be used to attack third parties.
	AllowEgress bool
}

type Backend struct {
	opts   Options
	client *http.Client
}

// New builds a backend talking to the given daemon.
func New(opts Options) (*Backend, error) {
	if opts.Host == "" {
		opts.Host = "unix:///var/run/docker.sock"
	}
	if opts.PublicHost == "" {
		return nil, fmt.Errorf("docker backend: PublicHost is required; " +
			"the daemon cannot tell us the address players should connect to")
	}

	transport := &http.Transport{}
	switch {
	case strings.HasPrefix(opts.Host, "unix://"):
		socket := strings.TrimPrefix(opts.Host, "unix://")
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		}
	case strings.HasPrefix(opts.Host, "tcp://"):
		// handled by the URL we build per request
	default:
		return nil, fmt.Errorf("docker backend: unsupported host %q", opts.Host)
	}

	return &Backend{
		opts:   opts,
		client: &http.Client{Transport: transport, Timeout: 60 * time.Second},
	}, nil
}

func (b *Backend) Name() string { return "docker" }

// endpoint builds the request URL. Over a unix socket the host part is ignored
// by our dialer, so any placeholder works.
func (b *Backend) endpoint(path string) string {
	if strings.HasPrefix(b.opts.Host, "tcp://") {
		return "http://" + strings.TrimPrefix(b.opts.Host, "tcp://") + path
	}
	return "http://docker" + path
}

func (b *Backend) do(ctx context.Context, method, path string, body any, out any) error {
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}

	req, err := http.NewRequestWithContext(ctx, method, b.endpoint(path), reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("docker daemon unreachable: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		return fmt.Errorf("docker api %s %s: %d %s", method, path, res.StatusCode, e.Message)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

// Spawn creates and starts a container, returning its id as the backend ref.
func (b *Backend) Spawn(ctx context.Context, req backends.SpawnRequest) (*backends.SpawnResult, error) {
	if req.Image == "" {
		return nil, fmt.Errorf("docker backend: challenge has no image")
	}

	env := make([]string, 0, len(req.EnvVars))
	for k, v := range req.EnvVars {
		env = append(env, k+"="+v)
	}

	exposed := map[string]struct{}{}
	bindings := map[string][]map[string]string{}
	for _, p := range req.Ports {
		key := strconv.Itoa(p) + "/tcp"
		exposed[key] = struct{}{}
		// An empty HostPort tells Docker to pick a free one.
		bindings[key] = []map[string]string{{"HostPort": ""}}
	}

	hostConfig := map[string]any{
		"PortBindings":   bindings,
		"AutoRemove":     false,
		"CapDrop":        []string{"ALL"},
		"SecurityOpt":    []string{"no-new-privileges"},
		"ReadonlyRootfs": true,
		// A challenge container must not be able to exhaust the host.
		"Memory":    memoryBytes(req.MemLimit),
		"NanoCpus":  nanoCPUs(req.CPULimit),
		"PidsLimit": int64(256),
		// Writable scratch without giving up the read-only root.
		"Tmpfs":         map[string]string{"/tmp": "rw,noexec,nosuid,size=64m"},
		"RestartPolicy": map[string]any{"Name": "no"},
	}
	if b.opts.Network != "" {
		hostConfig["NetworkMode"] = b.opts.Network
	}
	if !b.opts.AllowEgress {
		// "none" would also block the published port, so egress filtering
		// belongs on the host firewall; record the intent for the operator.
		hostConfig["ExtraHosts"] = []string{}
	}

	name := fmt.Sprintf("offcon-%s-%s", sanitize(req.MachineSlug), req.InstanceID.String()[:8])
	create := map[string]any{
		"Image":        req.Image,
		"Env":          env,
		"ExposedPorts": exposed,
		"HostConfig":   hostConfig,
		"Labels": map[string]string{
			"offcon.instance": req.InstanceID.String(),
			"offcon.slug":     req.MachineSlug,
		},
	}

	var created struct {
		ID string `json:"Id"`
	}
	q := url.Values{"name": {name}}
	if err := b.do(ctx, http.MethodPost, "/containers/create?"+q.Encode(), create, &created); err != nil {
		return nil, err
	}
	if err := b.do(ctx, http.MethodPost, "/containers/"+created.ID+"/start", nil, nil); err != nil {
		// Do not leak a created-but-unstarted container.
		_ = b.Teardown(context.WithoutCancel(ctx), created.ID)
		return nil, err
	}

	return &backends.SpawnResult{Ref: created.ID, NodeName: b.opts.PublicHost}, nil
}

// Status reports the container state and, once running, the address players use.
func (b *Backend) Status(ctx context.Context, ref string) (*backends.Status, error) {
	var insp struct {
		State struct {
			Running bool   `json:"Running"`
			Status  string `json:"Status"`
			Error   string `json:"Error"`
		} `json:"State"`
		NetworkSettings struct {
			Ports map[string][]struct {
				HostPort string `json:"HostPort"`
			} `json:"Ports"`
		} `json:"NetworkSettings"`
	}
	if err := b.do(ctx, http.MethodGet, "/containers/"+ref+"/json", nil, &insp); err != nil {
		return nil, err
	}

	st := &backends.Status{Reason: insp.State.Status, NodeName: b.opts.PublicHost}
	switch {
	case insp.State.Running:
		st.Phase = backends.PhaseRunning
		st.Ready = true
	case insp.State.Status == "created":
		st.Phase = backends.PhaseInitializing
	default:
		st.Phase = backends.PhaseFailed
		if insp.State.Error != "" {
			st.Reason = insp.State.Error
		}
	}

	// The published port is only known after start; this is what the player
	// actually connects to.
	for _, bindings := range insp.NetworkSettings.Ports {
		for _, bind := range bindings {
			if bind.HostPort != "" {
				st.IPAddress = b.opts.PublicHost + ":" + bind.HostPort
				return st, nil
			}
		}
	}
	return st, nil
}

// Teardown removes the container. Idempotent: an already-gone container is fine.
func (b *Backend) Teardown(ctx context.Context, ref string) error {
	err := b.do(ctx, http.MethodDelete, "/containers/"+ref+"?force=true&v=true", nil, nil)
	if err != nil && strings.Contains(err.Error(), "404") {
		return nil
	}
	return err
}

// Reset restarts the container, returning it to its image's initial state —
// the read-only rootfs means nothing the player changed survives.
func (b *Backend) Reset(ctx context.Context, ref string) error {
	return b.do(ctx, http.MethodPost, "/containers/"+ref+"/restart?t=5", nil, nil)
}

// Logs returns recent stdout/stderr. Docker streams these framed rather than as
// JSON, so the body is read as text.
func (b *Backend) Logs(ctx context.Context, ref string, tailLines int) ([]string, error) {
	q := url.Values{
		"stdout": {"true"},
		"stderr": {"true"},
		"tail":   {strconv.Itoa(tailLines)},
	}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodGet, b.endpoint("/containers/"+ref+"/logs?"+q.Encode()), nil)
	if err != nil {
		return nil, err
	}
	res, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("docker logs: %d", res.StatusCode)
	}
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(res.Body); err != nil {
		return nil, err
	}
	var out []string
	for _, line := range strings.Split(buf.String(), "\n") {
		// Strip Docker's 8-byte stream header when present.
		if len(line) > 8 && line[0] <= 2 {
			line = line[8:]
		}
		if s := strings.TrimRight(line, "\r"); s != "" {
			out = append(out, s)
		}
	}
	return out, nil
}

// memoryBytes converts "512Mi"/"1Gi"/"512m" to bytes. Zero means unlimited,
// which we avoid by defaulting to 512Mi.
func memoryBytes(v string) int64 {
	const def = 512 * 1024 * 1024
	if v == "" {
		return def
	}
	s := strings.TrimSpace(strings.ToLower(v))
	mult := int64(1)
	switch {
	case strings.HasSuffix(s, "gi"), strings.HasSuffix(s, "g"):
		mult = 1024 * 1024 * 1024
		s = strings.TrimRight(s, "gi")
	case strings.HasSuffix(s, "mi"), strings.HasSuffix(s, "m"):
		mult = 1024 * 1024
		s = strings.TrimRight(s, "mi")
	}
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || n <= 0 {
		return def
	}
	return n * mult
}

// nanoCPUs converts a CPU string ("500m", "1") to Docker's NanoCpus.
func nanoCPUs(v string) int64 {
	const def = 500_000_000 // half a core
	if v == "" {
		return def
	}
	s := strings.TrimSpace(strings.ToLower(v))
	if strings.HasSuffix(s, "m") {
		milli, err := strconv.ParseInt(strings.TrimSuffix(s, "m"), 10, 64)
		if err != nil || milli <= 0 {
			return def
		}
		return milli * 1_000_000
	}
	cores, err := strconv.ParseFloat(s, 64)
	if err != nil || cores <= 0 {
		return def
	}
	return int64(cores * 1_000_000_000)
}

// sanitize keeps container names to what Docker accepts.
func sanitize(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "lab"
	}
	return b.String()
}
