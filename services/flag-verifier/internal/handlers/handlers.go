package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	scoringerrors "github.com/offensive-conditions/flag-verifier/internal/errors"
	"github.com/offensive-conditions/flag-verifier/internal/middleware"
	"github.com/offensive-conditions/flag-verifier/internal/service"
)

// =============================================================================
// Health
// =============================================================================

type HealthHandler struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	version string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, version string) *HealthHandler {
	return &HealthHandler{db: db, redis: rdb, version: version}
}

func (h *HealthHandler) Register(r *gin.Engine) {
	r.GET("/healthz", h.healthz)
	r.GET("/readyz", h.readyz)
	r.GET("/livez", h.healthz)
}

func (h *HealthHandler) healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "flag-verifier", "version": h.version})
}

func (h *HealthHandler) readyz(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	result := gin.H{"status": "ok"}
	failed := false
	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			result["db"] = err.Error()
			failed = true
		} else {
			result["db"] = "ok"
		}
	}
	if h.redis != nil {
		if err := h.redis.Ping(ctx).Err(); err != nil {
			result["redis"] = err.Error()
			failed = true
		} else {
			result["redis"] = "ok"
		}
	}
	if failed {
		result["status"] = "degraded"
		c.JSON(http.StatusServiceUnavailable, result)
		return
	}
	c.JSON(http.StatusOK, result)
}

// =============================================================================
// Flag submission
// =============================================================================

type FlagHandler struct {
	svc *service.Verifier
	log zerolog.Logger
}

func NewFlagHandler(svc *service.Verifier, log zerolog.Logger) *FlagHandler {
	return &FlagHandler{svc: svc, log: log}
}

func (h *FlagHandler) Register(g *gin.RouterGroup) {
	g.POST("/flags/submit", h.submit)
	g.GET("/flags/history", h.history)
	g.GET("/flags/stats/:content_id", h.stats)
}

type submitRequest struct {
	Flag        string     `json:"flag" binding:"required,min=10,max=256"`
	ContentType string     `json:"content_type" binding:"required,oneof=machine challenge ctf_challenge dojo_level prolab_flag"`
	ContentID   uuid.UUID  `json:"content_id" binding:"required"`
	InstanceID  *uuid.UUID `json:"instance_id,omitempty"`
}

type submitResponse struct {
	Accepted        bool       `json:"accepted"`
	SubmissionID    uuid.UUID  `json:"submission_id"`
	FlagType        string    `json:"flag_type,omitempty"`
	IsFirstBlood    bool      `json:"is_first_blood"`
	BloodRank       int       `json:"blood_rank,omitempty"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	SecondsToSolve  int       `json:"seconds_to_solve,omitempty"`
	Message         string    `json:"message,omitempty"`
	FromCache       bool      `json:"from_cache,omitempty"`
	SubmittedAt     time.Time `json:"submitted_at"`
}

func (h *FlagHandler) submit(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}

	var req submitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, err.Error()))
		return
	}

	result, sErr := h.svc.SubmitFlag(c.Request.Context(), service.SubmitInput{
		UserID:      userID,
		ContentType: req.ContentType,
		ContentID:   req.ContentID,
		InstanceID:  req.InstanceID,
		Flag:        req.Flag,
		IPAddress:   c.ClientIP(),
		UserAgent:   c.GetHeader("User-Agent"),
		RequestID:   middleware.RequestIDFrom(c),
	})
	if sErr != nil {
		if sErr.RetryAfterSeconds > 0 {
			c.Header("Retry-After", strconv.Itoa(sErr.RetryAfterSeconds))
		}
		respondError(c, sErr)
		return
	}

	c.JSON(http.StatusOK, submitResponse{
		Accepted:        result.Accepted,
		SubmissionID:    result.SubmissionID,
		FlagType:        result.FlagType,
		IsFirstBlood:    result.IsFirstBlood,
		BloodRank:       result.BloodRank,
		RejectionReason: result.RejectionReason,
		SecondsToSolve:  result.SecondsToSolve,
		Message:         result.Message,
		FromCache:       result.FromCache,
		SubmittedAt:     time.Now().UTC(),
	})
}

func (h *FlagHandler) history(c *gin.Context) {
	userID, ok := middleware.UserIDFrom(c)
	if !ok {
		respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "auth required"))
		return
	}
	limit, offset := parsePagination(c)
	history, err := h.svc.ListHistory(c.Request.Context(), userID, limit, offset)
	if err != nil {
		respondError(c, scoringerrors.Internal(err))
		return
	}

	type historyItem struct {
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
	out := make([]historyItem, 0, len(history))
	for _, s := range history {
		out = append(out, historyItem{
			ID: s.ID, ContentType: s.ContentType, ContentID: s.ContentID,
			FlagType: s.FlagType, Accepted: s.Accepted,
			RejectionReason: s.RejectionReason,
			IsFirstBlood:    s.IsFirstBlood, BloodRank: s.BloodRank,
			SubmittedAt: s.SubmittedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"submissions": out, "limit": limit, "offset": offset})
}

func (h *FlagHandler) stats(c *gin.Context) {
	// Stub for v1: stats endpoint useful for showing "X people have solved this"
	// Full impl would query scoring.owns counts. For now, return placeholder.
	contentID, err := uuid.Parse(c.Param("content_id"))
	if err != nil {
		respondError(c, scoringerrors.New(scoringerrors.CodeBadRequest, "invalid content_id"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"content_id":     contentID,
		"total_solvers":  0,
		"first_blood_at": nil,
	})
}

// =============================================================================
// Helpers
// =============================================================================

func parsePagination(c *gin.Context) (limit, offset int) {
	limit = 50
	offset = 0
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	return
}

func respondError(c *gin.Context, err *scoringerrors.Error) {
	if err.RetryAfterSeconds > 0 {
		c.Header("Retry-After", strconv.Itoa(err.RetryAfterSeconds))
	}
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}
