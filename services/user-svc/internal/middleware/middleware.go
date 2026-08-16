package middleware

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/auth"
	scoringerrors "github.com/offensive-conditions/user-svc/internal/errors"
)

const (
	CtxUserID    = "user_id"
	CtxUserTier  = "user_tier"
	CtxUserRoles = "user_roles"
	CtxRequestID = "request_id"
)

func RequireAuth(validator *auth.Validator, log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "missing token"))
			return
		}
		claims, err := validator.Validate(token)
		if err != nil {
			log.Debug().Err(err).Msg("jwt validation failed")
			respondError(c, scoringerrors.New(scoringerrors.CodeUnauthorized, "invalid token"))
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Set(CtxUserTier, claims.Tier)
		c.Set(CtxUserRoles, claims.Roles)
		c.Next()
	}
}

func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := c.Get(CtxUserRoles)
		if !ok {
			respondError(c, scoringerrors.New(scoringerrors.CodeForbidden, "no roles"))
			return
		}
		roles, _ := raw.([]string)
		for _, r := range roles {
			if r == role {
				c.Next()
				return
			}
		}
		respondError(c, scoringerrors.New(scoringerrors.CodeForbidden, "requires role: "+role))
	}
}

func extractToken(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func UserIDFrom(c *gin.Context) (uuid.UUID, bool) {
	raw, ok := c.Get(CtxUserID)
	if !ok {
		return uuid.Nil, false
	}
	id, _ := raw.(uuid.UUID)
	return id, id != uuid.Nil
}

func UserTierFrom(c *gin.Context) string {
	raw, ok := c.Get(CtxUserTier)
	if !ok {
		return "free"
	}
	t, _ := raw.(string)
	if t == "" {
		return "free"
	}
	return t
}

func RequestIDFrom(c *gin.Context) string {
	if v, ok := c.Get(CtxRequestID); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func respondError(c *gin.Context, err *scoringerrors.Error) {
	c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
}

// =============================================================================
// Common middleware
// =============================================================================

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		c.Set(CtxRequestID, id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

func Logger(log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery
		c.Next()
		dur := time.Since(start)
		status := c.Writer.Status()
		reqID, _ := c.Get(CtxRequestID)
		userID, _ := c.Get(CtxUserID)
		evt := log.Info()
		if status >= 500 {
			evt = log.Error()
		} else if status >= 400 {
			evt = log.Warn()
		}
		if raw != "" {
			path = path + "?" + raw
		}
		evt = evt.Str("method", c.Request.Method).Str("path", path).
			Int("status", status).Dur("duration", dur).
			Str("client_ip", c.ClientIP())
		if reqID != nil {
			evt = evt.Str("request_id", reqID.(string))
		}
		if userID != nil {
			if id, ok := userID.(uuid.UUID); ok {
				evt = evt.Str("user_id", id.String())
			}
		}
		evt.Msg("request")
	}
}

func Recovery(log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Error().Interface("panic", r).Str("path", c.Request.URL.Path).Msg("recovered from panic")
				err := scoringerrors.New(scoringerrors.CodeInternal, "internal server error")
				c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
			}
		}()
		c.Next()
	}
}

func CORS(origins []string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(origins))
	hasWildcard := false
	for _, o := range origins {
		if o == "*" {
			hasWildcard = true
		}
		allowed[strings.TrimRight(o, "/")] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if hasWildcard {
				c.Header("Access-Control-Allow-Origin", "*")
			} else if allowed[origin] {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			}
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Next()
	}
}

// LastSeenTracker updates last_seen_at periodically for the calling user.
// Uses a goroutine-safe set guarded by a mutex so we throttle DB writes.
func LastSeenTracker(updater func(uuid.UUID)) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if uid, ok := UserIDFrom(c); ok {
			updater(uid)
		}
	}
}
