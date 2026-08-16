package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/orchestrator/internal/auth"
	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
)

// Context keys
const (
	CtxUserID    = "user_id"
	CtxUserTier  = "user_tier"
	CtxUserRoles = "user_roles"
	CtxSessionID = "session_id"
	CtxRequestID = "request_id"
)

// RequireAuth ensures the request has a valid JWT and injects claims into ctx.
func RequireAuth(validator *auth.Validator, log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := extractToken(c)
		if tokenStr == "" {
			respondError(c, autherrors.New(autherrors.CodeUnauthorized, "missing or invalid Authorization header"))
			return
		}

		claims, err := validator.Validate(tokenStr)
		if err != nil {
			log.Debug().Err(err).Msg("jwt validation failed")
			respondError(c, autherrors.New(autherrors.CodeUnauthorized, "invalid token"))
			return
		}

		c.Set(CtxUserID, claims.UserID)
		c.Set(CtxUserTier, claims.Tier)
		c.Set(CtxUserRoles, claims.Roles)
		c.Set(CtxSessionID, claims.SessionID)
		c.Next()
	}
}

// RequireRole gates a route to users with a specific role.
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := c.Get(CtxUserRoles)
		if !ok {
			respondError(c, autherrors.New(autherrors.CodeForbidden, "no roles in token"))
			return
		}
		roles, _ := raw.([]string)
		for _, r := range roles {
			if r == role {
				c.Next()
				return
			}
		}
		respondError(c, autherrors.New(autherrors.CodeForbidden, "requires role: "+role))
	}
}

func extractToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// UserIDFrom is a helper to safely extract the user ID set by RequireAuth.
func UserIDFrom(c *gin.Context) (uuid.UUID, bool) {
	raw, ok := c.Get(CtxUserID)
	if !ok {
		return uuid.Nil, false
	}
	id, ok := raw.(uuid.UUID)
	return id, ok
}

// UserTierFrom returns the tier ("free"|"pro"|"enterprise"), empty string if missing.
func UserTierFrom(c *gin.Context) string {
	raw, ok := c.Get(CtxUserTier)
	if !ok {
		return ""
	}
	t, _ := raw.(string)
	return t
}

func respondError(c *gin.Context, err *autherrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}
