package observability

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

// HTTPMiddleware wraps an http.Handler with RED metrics + trace propagation.
// `routePattern` is a function that maps a request to its route template
// (e.g. "/v1/machines/{slug}") so high-cardinality paths don't explode labels.
func HTTPMiddleware(routePattern func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		instrumented := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if globalMetrics == nil {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			globalMetrics.HTTPInflight.Inc()
			defer globalMetrics.HTTPInflight.Dec()

			rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rw, r)

			path := routePattern(r)
			if path == "" {
				path = "unmatched"
			}
			statusStr := strconv.Itoa(rw.status)
			globalMetrics.HTTPRequests.WithLabelValues(r.Method, path, statusStr).Inc()
			globalMetrics.HTTPDuration.WithLabelValues(r.Method, path, statusStr).
				Observe(time.Since(start).Seconds())
		})
		// otelhttp adds trace context extraction + span creation around it.
		return otelhttp.NewHandler(instrumented, "http.server")
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wrote {
		r.wrote = true
	}
	return r.ResponseWriter.Write(b)
}

// UnaryServerInterceptor returns a gRPC interceptor emitting RED metrics.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if globalMetrics == nil {
			return handler(ctx, req)
		}
		start := time.Now()
		svc, method := splitFullMethod(info.FullMethod)
		resp, err := handler(ctx, req)

		code := status.Code(err)
		globalMetrics.GRPCHandled.WithLabelValues(svc, method, code.String()).Inc()
		globalMetrics.GRPCDuration.WithLabelValues(svc, method).Observe(time.Since(start).Seconds())
		return resp, err
	}
}

// splitFullMethod turns "/offcon.auth.AuthService/Login" into
// ("offcon.auth.AuthService", "Login").
func splitFullMethod(full string) (service, method string) {
	if len(full) == 0 || full[0] != '/' {
		return "unknown", full
	}
	full = full[1:]
	for i := len(full) - 1; i >= 0; i-- {
		if full[i] == '/' {
			return full[:i], full[i+1:]
		}
	}
	return full, "unknown"
}
