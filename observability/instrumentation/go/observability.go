// Package observability provides drop-in metrics + tracing + structured
// logging for OFFCON Go services. A service wires it up with a single call:
//
//	shutdown, err := observability.Init(ctx, observability.Config{
//	    ServiceName: "auth-svc",
//	    Tier:        "core",
//	})
//	defer shutdown(ctx)
//
// It exposes a Prometheus /metrics handler, instruments HTTP + gRPC with RED
// metrics, and exports OTLP traces to the collector. All metric names follow
// the conventions documented in prometheus/prometheus.yml.
package observability

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// Config configures the observability stack for a service.
type Config struct {
	ServiceName string
	Tier        string
	// OTLPEndpoint defaults to the OTEL_EXPORTER_OTLP_ENDPOINT env or
	// "otel-collector:4317".
	OTLPEndpoint string
	// SampleRatio is the parent-based sample ratio when the collector isn't
	// doing tail sampling. Defaults to 1.0 (collector decides).
	SampleRatio float64
}

// Metrics holds the standard RED metric collectors for a service.
type Metrics struct {
	HTTPRequests *prometheus.CounterVec
	HTTPDuration *prometheus.HistogramVec
	HTTPInflight prometheus.Gauge
	GRPCHandled  *prometheus.CounterVec
	GRPCDuration *prometheus.HistogramVec
	registry     *prometheus.Registry
}

var (
	globalMetrics *Metrics
	tracer        trace.Tracer
)

// Init sets up metrics + tracing and returns a shutdown function.
func Init(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	if cfg.ServiceName == "" {
		return nil, fmt.Errorf("observability: ServiceName is required")
	}
	if cfg.OTLPEndpoint == "" {
		cfg.OTLPEndpoint = envOr("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317")
	}
	if cfg.SampleRatio == 0 {
		cfg.SampleRatio = 1.0
	}

	globalMetrics = newMetrics(cfg)

	// Tracing: OTLP gRPC exporter → collector
	exp, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(cfg.OTLPEndpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: trace exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
			attribute.String("tier", cfg.Tier),
			semconv.DeploymentEnvironment(envOr("DEPLOY_ENV", "production")),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(cfg.SampleRatio))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))
	tracer = tp.Tracer(cfg.ServiceName)

	return func(shutdownCtx context.Context) error {
		return tp.Shutdown(shutdownCtx)
	}, nil
}

// MetricsHandler returns the Prometheus /metrics HTTP handler.
func MetricsHandler() http.Handler {
	if globalMetrics == nil {
		return promhttp.Handler()
	}
	return promhttp.HandlerFor(globalMetrics.registry, promhttp.HandlerOpts{})
}

// Tracer returns the service tracer (safe even before Init — returns a noop).
func Tracer() trace.Tracer {
	if tracer == nil {
		return otel.Tracer("uninitialized")
	}
	return tracer
}

func newMetrics(cfg Config) *Metrics {
	reg := prometheus.NewRegistry()
	// Standard process + Go runtime collectors
	reg.MustRegister(prometheus.NewGoCollector())
	reg.MustRegister(prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}))

	constLabels := prometheus.Labels{"service": cfg.ServiceName}

	m := &Metrics{
		registry: reg,
		HTTPRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total", Help: "Total HTTP requests.", ConstLabels: constLabels,
		}, []string{"method", "path", "status"}),
		HTTPDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "http_request_duration_seconds", Help: "HTTP request latency.", ConstLabels: constLabels,
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		}, []string{"method", "path", "status"}),
		HTTPInflight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "http_inflight_requests", Help: "In-flight HTTP requests.", ConstLabels: constLabels,
		}),
		GRPCHandled: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "grpc_server_handled_total", Help: "Total gRPC calls handled.", ConstLabels: constLabels,
		}, []string{"grpc_service", "grpc_method", "grpc_code"}),
		GRPCDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "grpc_server_handling_seconds", Help: "gRPC handling latency.", ConstLabels: constLabels,
			Buckets: []float64{0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
		}, []string{"grpc_service", "grpc_method"}),
	}
	reg.MustRegister(m.HTTPRequests, m.HTTPDuration, m.HTTPInflight, m.GRPCHandled, m.GRPCDuration)
	return m
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
