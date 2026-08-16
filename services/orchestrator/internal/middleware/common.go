package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	autherrors "github.com/offensive-conditions/orchestrator/internal/errors"
)

// RequestID injects a request_id into the context and response headers.
// If the client provided one (X-Request-ID), we honor it; otherwise generate.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqID := c.GetHeader("X-Request-ID")
		if reqID == "" {
			reqID = uuid.NewString()
		}
		c.Set(CtxRequestID, reqID)
		c.Header("X-Request-ID", reqID)
		c.Next()
	}
}

// Logger logs each request with structured fields.
func Logger(log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		duration := time.Since(start)
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

		evt = evt.
			Str("method", c.Request.Method).
			Str("path", path).
			Int("status", status).
			Dur("duration", duration).
			Str("client_ip", c.ClientIP()).
			Str("ua", c.Request.UserAgent())

		if reqID != nil {
			evt = evt.Str("request_id", reqID.(string))
		}
		if userID != nil {
			if id, ok := userID.(uuid.UUID); ok {
				evt = evt.Str("user_id", id.String())
			}
		}
		if len(c.Errors) > 0 {
			evt = evt.Str("errors", c.Errors.String())
		}
		evt.Msg("request")
	}
}

// Recovery catches panics, logs them, and returns a 500.
func Recovery(log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				reqID, _ := c.Get(CtxRequestID)
				log.Error().
					Interface("panic", r).
					Str("path", c.Request.URL.Path).
					Interface("request_id", reqID).
					Msg("recovered from panic")
				err := autherrors.New(autherrors.CodeInternal, "internal server error")
				c.AbortWithStatusJSON(err.HTTPStatus(), gin.H{"error": err})
			}
		}()
		c.Next()
	}
}

// CORS allows configured origins.
func CORS(origins []string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		allowed[strings.TrimRight(o, "/")] = true
	}
	hasWildcard := false
	for _, o := range origins {
		if o == "*" {
			hasWildcard = true
			break
		}
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

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "3600")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// SecurityHeaders sets standard hardening headers.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Next()
	}
}
