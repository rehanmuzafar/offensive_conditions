package handlers

import (
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
	"github.com/offensive-conditions/orchestrator/internal/middleware"
	"github.com/offensive-conditions/orchestrator/internal/repository"
	"github.com/offensive-conditions/orchestrator/internal/service"
)

// InstanceHandler exposes HTTP endpoints for lab instance management.
type InstanceHandler struct {
	svc *service.Orchestrator
	log zerolog.Logger
}

func NewInstanceHandler(svc *service.Orchestrator, log zerolog.Logger) *InstanceHandler {
	return &InstanceHandler{svc: svc, log: log}
}

// Register attaches routes to the given group.
func (h *InstanceHandler) Register(g *gin.RouterGroup) {
	g.POST("/instances", h.spawn)
	g.GET("/instances/active", h.listActive)
	g.GET("/instances/:id", h.get)
	g.DELETE("/instances/:id", h.terminate)
	g.POST("/instances/:id/extend", h.extend)
	g.POST("/instances/:id/reset", h.reset)
	g.GET("/instances/:id/logs", h.logs)
	g.POST("/flags/submit", h.submitFlag)
}

// =============================================================================
// Spawn
// =============================================================================

type spawnRequest struct {
	MachineSlug string `json:"machine_slug" binding:"required"`
	TTLSeconds  int    `json:"ttl_seconds"`
}

type spawnResponse struct {
	InstanceID string    `json:"instance_id"`
	State      string    `json:"state"`
	ExpiresAt  time.Time `json:"expires_at"`
	IPAddress  string    `json:"ip_address,omitempty"`
	Subnet     string    `json:"subnet,omitempty"`
}

func (h *InstanceHandler) spawn(c *gin.Context) {
	var req spawnRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid JSON: "+err.Error()))
		return
	}

	meta := requestMetaFrom(c)
	out, err := h.svc.Spawn(c.Request.Context(), service.SpawnInput{
		MachineSlug: req.MachineSlug,
		TTL:         time.Duration(req.TTLSeconds) * time.Second,
	}, meta)
	if err != nil {
		respondError(c, toErr(err))
		return
	}

	c.JSON(http.StatusAccepted, spawnResponse{
		InstanceID: out.InstanceID.String(),
		State:      string(out.State),
		ExpiresAt:  out.ExpiresAt,
		IPAddress:  out.IPAddress,
		Subnet:     out.Subnet,
	})
}

// =============================================================================
// Get / List
// =============================================================================

type instanceResponse struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	MachineID     string     `json:"machine_id"`
	MachineSlug   string     `json:"machine_slug"`
	Backend       string     `json:"backend"`
	State         string     `json:"state"`
	IPAddress     string     `json:"ip_address,omitempty"`
	Subnet        string     `json:"subnet,omitempty"`
	HealthStatus  string     `json:"health_status,omitempty"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	ExpiresAt     time.Time  `json:"expires_at"`
	ExtensionsUsed int       `json:"extensions_used"`
	FailureReason string     `json:"failure_reason,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

func toInstanceResponse(in *repository.LabInstance) instanceResponse {
	r := instanceResponse{
		ID:             in.ID.String(),
		UserID:         in.UserID.String(),
		MachineID:      in.MachineID.String(),
		MachineSlug:    in.MachineSlug,
		Backend:        string(in.Backend),
		State:          string(in.State),
		Subnet:         in.Subnet,
		HealthStatus:   in.HealthStatus,
		StartedAt:      in.StartedAt,
		ExpiresAt:      in.ExpiresAt,
		ExtensionsUsed: in.ExtensionsUsed,
		FailureReason:  in.FailureReason,
		CreatedAt:      in.CreatedAt,
	}
	if in.IPAddress != nil {
		r.IPAddress = in.IPAddress.String()
	}
	return r
}

func (h *InstanceHandler) get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	inst, err := h.svc.Get(c.Request.Context(), id, requestMetaFrom(c))
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, toInstanceResponse(inst))
}

func (h *InstanceHandler) listActive(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, autherrors.New(autherrors.CodeUnauthorized, "no user in context"))
		return
	}
	list, err := h.svc.ListActiveForUser(c.Request.Context(), userID)
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	out := make([]instanceResponse, len(list))
	for i, in := range list {
		out[i] = toInstanceResponse(in)
	}
	c.JSON(http.StatusOK, gin.H{"instances": out})
}

// =============================================================================
// Terminate
// =============================================================================

func (h *InstanceHandler) terminate(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	if err := h.svc.Terminate(c.Request.Context(), id, requestMetaFrom(c)); err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "terminating"})
}

// =============================================================================
// Extend
// =============================================================================

func (h *InstanceHandler) extend(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	expiresAt, err := h.svc.Extend(c.Request.Context(), id, requestMetaFrom(c))
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"expires_at": expiresAt})
}

// =============================================================================
// Reset
// =============================================================================

func (h *InstanceHandler) reset(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	if err := h.svc.Reset(c.Request.Context(), id, requestMetaFrom(c)); err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "resetting"})
}

// =============================================================================
// Logs
// =============================================================================

func (h *InstanceHandler) logs(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	tail := 200
	if t := c.Query("tail"); t != "" {
		if n, err := strconv.Atoi(t); err == nil && n > 0 && n <= 2000 {
			tail = n
		}
	}
	lines, err := h.svc.Logs(c.Request.Context(), id, tail, requestMetaFrom(c))
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"lines": lines})
}

// =============================================================================
// Submit Flag
// =============================================================================

type submitFlagRequest struct {
	MachineSlug string  `json:"machine_slug" binding:"required"`
	InstanceID  *string `json:"instance_id"`
	FlagType    string  `json:"flag_type" binding:"required,oneof=user root"`
	Flag        string  `json:"flag" binding:"required"`
}

type submitFlagResponse struct {
	Correct       bool `json:"correct"`
	AlreadySolved bool `json:"already_solved"`
	PointsAwarded int  `json:"points_awarded"`
}

func (h *InstanceHandler) submitFlag(c *gin.Context) {
	var req submitFlagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid JSON: "+err.Error()))
		return
	}

	in := service.FlagSubmitInput{
		MachineSlug: req.MachineSlug,
		FlagType:    req.FlagType,
		Flag:        req.Flag,
	}
	if req.InstanceID != nil && *req.InstanceID != "" {
		id, err := uuid.Parse(*req.InstanceID)
		if err != nil {
			respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
			return
		}
		in.InstanceID = &id
	}

	out, err := h.svc.SubmitFlag(c.Request.Context(), in, requestMetaFrom(c))
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, submitFlagResponse{
		Correct:       out.Correct,
		AlreadySolved: out.AlreadySolved,
		PointsAwarded: out.PointsAwarded,
	})
}

// =============================================================================
// Helpers
// =============================================================================

func requestMetaFrom(c *gin.Context) service.RequestMeta {
	userID, _ := middleware.UserIDFrom(c)
	tier := middleware.UserTierFrom(c)
	reqID := ""
	if v, ok := c.Get(middleware.CtxRequestID); ok {
		reqID, _ = v.(string)
	}
	ip, _ := netip.ParseAddr(c.ClientIP())
	return service.RequestMeta{
		UserID:    userID,
		UserTier:  tier,
		IP:        ip,
		UserAgent: c.Request.UserAgent(),
		RequestID: reqID,
	}
}

func respondError(c *gin.Context, err *autherrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}

// toErr converts any error to a typed *autherrors.Error.
func toErr(err error) *autherrors.Error {
	if e, ok := autherrors.As(err); ok {
		return e
	}
	return autherrors.Internal(err)
}
