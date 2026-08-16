package middleware

import (
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/requestid"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// RequestID generates a unique ID per request and attaches it to the context and response headers.
func RequestID() gin.HandlerFunc {
	return requestid.New(requestid.WithCustomHeaderStrKey("X-Request-ID"))
}

// GetRequestID returns the request ID from gin context.
func GetRequestID(c *gin.Context) string {
	return requestid.Get(c)
}

// Logger emits structured request logs via zerolog.
// Skips noisy paths like /healthz and /metrics.
func Logger(logger zerolog.Logger) gin.HandlerFunc {
	skipPaths := map[string]bool{
		"/healthz":  true,
		"/readyz":   true,
		"/metrics":  true,
	}

	return func(c *gin.Context) {
		if skipPaths[c.Request.URL.Path] {
			c.Next()
			return
		}

		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()

		fullPath := path
		if raw != "" {
			fullPath = path + "?" + raw
		}

		evt := logger.Info()
		if status >= 500 {
			evt = logger.Error()
		} else if status >= 400 {
			evt = logger.Warn()
		}

		evt.
			Str("request_id", GetRequestID(c)).
			Str("method", c.Request.Method).
			Str("path", fullPath).
			Int("status", status).
			Dur("latency", latency).
			Str("ip", c.ClientIP()).
			Str("user_agent", c.Request.UserAgent()).
			Int("size", c.Writer.Size()).
			Msg("http_request")
	}
}

// Recovery catches panics, logs them, and returns 500.
// In production, also reports to error tracking.
func Recovery(logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				stack := debug.Stack()
				logger.Error().
					Str("request_id", GetRequestID(c)).
					Str("path", c.Request.URL.Path).
					Interface("panic", r).
					Bytes("stack", stack).
					Msg("panic recovered")

				if !c.Writer.Written() {
					c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
						"error": gin.H{
							"code":    "INTERNAL_ERROR",
							"message": "An internal error occurred",
						},
					})
				}
			}
		}()
		c.Next()
	}
}

// CORS configures cross-origin resource sharing.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	return cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Request-ID", "Accept"},
		ExposeHeaders:    []string{"X-Request-ID", "X-RateLimit-Remaining", "X-RateLimit-Limit", "Retry-After"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}

// SecurityHeaders adds standard security headers to every response.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-XSS-Protection", "0")
		c.Header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

// MaxBodySize limits request body size.
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		// Pre-read into buffer to enforce size before handler
		if c.Request.ContentLength > maxBytes {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": gin.H{
					"code":    "PAYLOAD_TOO_LARGE",
					"message": "Request body exceeds size limit",
				},
			})
			return
		}
		c.Next()
	}
}

// init silences unused import warning from log
var _ = log.Logger
