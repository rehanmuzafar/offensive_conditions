package handlers

import (
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
	"github.com/offensive-conditions/orchestrator/internal/backends"
)

// ContainerHandler starts a container from an image, with no machine behind it.
//
// The instance API cannot serve this: POST /instances takes a machine slug,
// looks it up in the machines catalogue, checks the caller's tier against it
// and generates per-instance user/root flags. A CTF challenge has none of that
// — it has an image, its own flag, and an event it belongs to.
//
// Deliberately mounted outside /v1 and NOT proxied by the edge, so it is
// reachable only from inside the compose network. It has to be: it takes an
// arbitrary image reference, and exposing that to end users would be a remote
// "run anything on my host" button.
type ContainerHandler struct {
	backend backends.Backend
	token   string
	log     zerolog.Logger
}

func NewContainerHandler(b backends.Backend, token string, log zerolog.Logger) *ContainerHandler {
	return &ContainerHandler{backend: b, token: token, log: log}
}

func (h *ContainerHandler) Register(g *gin.RouterGroup) {
	g.Use(h.requireToken)
	g.POST("/containers", h.spawn)
	g.DELETE("/containers/:ref", h.stop)
	g.GET("/containers/:ref", h.status)
}

// requireToken is the second lock on this group.
//
// The first is that the edge does not proxy /internal — but the compose file
// also publishes this service's port on the host, so "not proxied" is not the
// same as "not reachable". A shared secret means a stray published port, or
// another service on the network being compromised, is not by itself enough to
// run arbitrary containers here.
//
// Fails closed: with no token configured the group refuses everything rather
// than serving open, because an unauthenticated "run any image" endpoint is
// the worst possible default.
func (h *ContainerHandler) requireToken(c *gin.Context) {
	if h.token == "" {
		h.log.Error().Msg("internal container API called with no token configured")
		respondError(c, autherrors.New(autherrors.CodeUnauthorized, "internal API is not configured"))
		c.Abort()
		return
	}
	if subtle.ConstantTimeCompare([]byte(c.GetHeader("X-Internal-Token")), []byte(h.token)) != 1 {
		respondError(c, autherrors.New(autherrors.CodeUnauthorized, "invalid internal token"))
		c.Abort()
		return
	}
	c.Next()
}

type containerSpawnRequest struct {
	//: Image to run, e.g. registry/challenges/babyrop:v1
	Image string `json:"image" binding:"required"`
	//: Ports inside the container to publish. The host port is chosen by the
	//: daemon and returned, so callers never have to manage a port range.
	Ports []int `json:"ports"`
	//: Handed to the container — a CTF challenge's flag goes here.
	Env        map[string]string `json:"env"`
	TTLSeconds int               `json:"ttl_seconds"`
	CPULimit   string            `json:"cpu_limit"`
	MemLimit   string            `json:"mem_limit"`
	//: For naming and labels only.
	Label string `json:"label"`
}

type containerSpawnResponse struct {
	Ref       string    `json:"ref"`
	Host      string    `json:"host"`
	Port      int       `json:"port"`
	State     string    `json:"state"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (h *ContainerHandler) spawn(c *gin.Context) {
	var req containerSpawnRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid JSON: "+err.Error()))
		return
	}
	if len(req.Ports) == 0 {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "at least one port is required"))
		return
	}
	ttl := time.Duration(req.TTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	if req.CPULimit == "" {
		req.CPULimit = "1000m"
	}
	if req.MemLimit == "" {
		req.MemLimit = "512Mi"
	}

	instanceID := uuid.New()
	out, err := h.backend.Spawn(c.Request.Context(), backends.SpawnRequest{
		InstanceID:  instanceID,
		MachineSlug: req.Label,
		Image:       req.Image,
		Ports:       req.Ports,
		EnvVars:     req.Env,
		CPULimit:    req.CPULimit,
		MemLimit:    req.MemLimit,
		TTL:         ttl,
	})
	if err != nil {
		h.log.Error().Err(err).Str("image", req.Image).Msg("container spawn failed")
		respondError(c, toErr(err))
		return
	}

	// The daemon assigns the host port, so the address is only knowable after
	// the container exists. Status carries it.
	st, _ := h.backend.Status(c.Request.Context(), out.Ref)
	host, port := "", 0
	if st != nil {
		host, port = splitHostPort(st.IPAddress)
	}

	c.JSON(http.StatusAccepted, containerSpawnResponse{
		Ref:       out.Ref,
		Host:      host,
		Port:      port,
		State:     "queued",
		ExpiresAt: time.Now().Add(ttl),
	})
}

func (h *ContainerHandler) status(c *gin.Context) {
	ref := c.Param("ref")
	st, err := h.backend.Status(c.Request.Context(), ref)
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	host, port := splitHostPort(st.IPAddress)
	c.JSON(http.StatusOK, gin.H{
		"ref":   ref,
		"state": st.Reason,
		"phase": string(st.Phase),
		"ready": st.Ready,
		"host":  host,
		"port":  port,
	})
}

func (h *ContainerHandler) stop(c *gin.Context) {
	if err := h.backend.Teardown(c.Request.Context(), c.Param("ref")); err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "stopped"})
}

// splitHostPort pulls "10.0.0.5:32768" apart. The backend reports the address
// as one string because that is what a player pastes into a terminal.
func splitHostPort(addr string) (string, int) {
	if addr == "" {
		return "", 0
	}
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			port := 0
			for _, ch := range addr[i+1:] {
				if ch < '0' || ch > '9' {
					return addr, 0
				}
				port = port*10 + int(ch-'0')
			}
			return addr[:i], port
		}
	}
	return addr, 0
}
