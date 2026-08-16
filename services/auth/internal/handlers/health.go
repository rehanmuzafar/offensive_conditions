package handlers

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HealthHandler provides liveness and readiness endpoints.
type HealthHandler struct {
	db      *pgxpool.Pool
	rdb     *redis.Client
	version string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, version string) *HealthHandler {
	return &HealthHandler{db: db, rdb: rdb, version: version}
}

// GET /healthz — Liveness. Returns 200 if the process is alive.
func (h *HealthHandler) Liveness(c *gin.Context) {
	c.JSON(200, gin.H{
		"status":  "ok",
		"version": h.version,
		"time":    time.Now().UTC(),
	})
}

// GET /readyz — Readiness. Returns 200 only if all dependencies are reachable.
func (h *HealthHandler) Readiness(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	checks := gin.H{}
	allOK := true

	// DB ping
	if err := h.db.Ping(ctx); err != nil {
		checks["database"] = gin.H{"status": "down", "error": err.Error()}
		allOK = false
	} else {
		checks["database"] = gin.H{"status": "up"}
	}

	// Redis ping
	if err := h.rdb.Ping(ctx).Err(); err != nil {
		checks["redis"] = gin.H{"status": "down", "error": err.Error()}
		allOK = false
	} else {
		checks["redis"] = gin.H{"status": "up"}
	}

	status := 200
	overall := "ready"
	if !allOK {
		status = 503
		overall = "not_ready"
	}

	c.JSON(status, gin.H{
		"status":  overall,
		"checks":  checks,
		"version": h.version,
	})
}
