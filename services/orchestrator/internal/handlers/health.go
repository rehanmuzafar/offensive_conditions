package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HealthHandler exposes /healthz and /readyz.
//
// /healthz returns 200 always if the process is running.
// /readyz returns 200 only if dependencies (DB, Redis) are reachable.
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
	r.GET("/livez", h.healthz) // alias
}

func (h *HealthHandler) healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "orchestrator",
		"version": h.version,
	})
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
