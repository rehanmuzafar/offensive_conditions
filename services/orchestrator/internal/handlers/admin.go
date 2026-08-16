package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
	"github.com/offensive-conditions/orchestrator/internal/service"
)

// AdminHandler exposes operator-only routes.
type AdminHandler struct {
	svc *service.Orchestrator
	log zerolog.Logger
}

func NewAdminHandler(svc *service.Orchestrator, log zerolog.Logger) *AdminHandler {
	return &AdminHandler{svc: svc, log: log}
}

func (h *AdminHandler) Register(g *gin.RouterGroup) {
	g.GET("/admin/capacity", h.capacity)
	g.POST("/admin/instances/:id/force-kill", h.forceKill)
}

func (h *AdminHandler) capacity(c *gin.Context) {
	snaps, err := h.svc.GetCapacity(c.Request.Context())
	if err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"capacity": snaps})
}

// forceKill bypasses the user-ownership check and forcibly terminates an instance.
func (h *AdminHandler) forceKill(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		respondError(c, autherrors.New(autherrors.CodeBadRequest, "invalid instance id"))
		return
	}
	meta := requestMetaFrom(c)
	// We re-use the standard Terminate path but log the override.
	h.log.Warn().
		Str("admin_user_id", meta.UserID.String()).
		Str("target_instance_id", id.String()).
		Msg("admin force-kill")
	if err := h.svc.Terminate(c.Request.Context(), id, meta); err != nil {
		respondError(c, toErr(err))
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "terminating"})
}
