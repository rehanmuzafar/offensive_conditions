// Package server exposes the aggregated health endpoints.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/offcon/gateway/healthcheck/internal/checker"
	"github.com/offcon/gateway/healthcheck/internal/config"
)

// Server wraps the HTTP handlers.
type Server struct {
	cfg     config.Config
	checker *checker.Checker
	logger  *slog.Logger
}

// New constructs a Server.
func New(cfg config.Config, c *checker.Checker, logger *slog.Logger) *Server {
	return &Server{cfg: cfg, checker: c, logger: logger}
}

// Handler returns the mux with all routes registered.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/readyz", s.handleReadyz)
	mux.HandleFunc("/livez", s.handleLivez)
	return s.withLogging(mux)
}

// handleHealthz returns the full aggregated downstream report.
func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	report := s.checker.Get(r.Context())
	code := http.StatusOK
	if !report.Healthy {
		code = http.StatusServiceUnavailable
	}
	s.writeJSON(w, code, report)
}

// handleReadyz is a lightweight readiness check — the aggregator is ready as
// long as it can serve. It does NOT block on downstream health (use /healthz
// for that) so the gateway pod stays in rotation even if a backend is down.
func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// handleLivez is the kubelet liveness probe.
func (s *Server) handleLivez(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
}

func (s *Server) writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.logger.Error("failed to encode response", "error", err)
	}
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		// Only log non-probe noise at debug to avoid flooding
		level := slog.LevelDebug
		if rw.status >= 500 {
			level = slog.LevelWarn
		}
		s.logger.Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}
