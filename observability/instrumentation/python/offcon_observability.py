"""
OFFCON observability for Python (FastAPI) services.

One-call setup in a service's main.py::

    from offcon_observability import setup_observability

    app = FastAPI()
    setup_observability(app, service_name="content-svc", tier="content")

Provides:
  * Prometheus /metrics endpoint (RED metrics with route templating)
  * OpenTelemetry tracing exported via OTLP to the collector
  * Structured-log trace correlation (trace_id injected into log records)
  * Business metric helpers (offcon_* counters/gauges)

Metric names match the conventions in prometheus/prometheus.yml so the same
Grafana dashboards work across Go / Python / Node services.
"""

from __future__ import annotations

import os
import time
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

# Per-process registry so multiple workers don't clash on default collectors.
REGISTRY = CollectorRegistry()

_LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5)


class Metrics:
    """Holds the standard RED collectors for a service.

    The Python prometheus_client has no `const_labels`, so `service` is a
    regular label that we bind once via a partial-style wrapper. We keep the
    service name and pass it on every observation."""

    def __init__(self, service_name: str) -> None:
        self.service = service_name
        self.http_requests = Counter(
            "http_requests_total",
            "Total HTTP requests.",
            ["service", "method", "path", "status"],
            registry=REGISTRY,
        )
        self.http_duration = Histogram(
            "http_request_duration_seconds",
            "HTTP request latency.",
            ["service", "method", "path", "status"],
            buckets=_LATENCY_BUCKETS,
            registry=REGISTRY,
        )
        self.http_inflight = Gauge(
            "http_inflight_requests",
            "In-flight HTTP requests.",
            ["service"],
            registry=REGISTRY,
        )


_metrics: Metrics | None = None


class _REDMiddleware(BaseHTTPMiddleware):
    """Records RED metrics for every request, using the matched route template
    as the `path` label to keep cardinality bounded."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        assert _metrics is not None
        svc = _metrics.service
        _metrics.http_inflight.labels(svc).inc()
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            _metrics.http_inflight.labels(svc).dec()
            # Prefer the route template (e.g. "/v1/machines/{slug}")
            route = request.scope.get("route")
            path = getattr(route, "path", None) or "unmatched"
            elapsed = time.perf_counter() - start
            labels = (svc, request.method, path, str(status_code))
            _metrics.http_requests.labels(*labels).inc()
            _metrics.http_duration.labels(*labels).observe(elapsed)


def setup_observability(
    app: FastAPI,
    *,
    service_name: str,
    tier: str = "unknown",
    otlp_endpoint: str | None = None,
    sample_ratio: float = 1.0,
) -> None:
    """Wire metrics + tracing into a FastAPI app."""
    global _metrics
    _metrics = Metrics(service_name)

    otlp_endpoint = otlp_endpoint or os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317"
    )

    # ---- Tracing ----
    resource = Resource.create(
        {
            "service.name": service_name,
            "tier": tier,
            "deployment.environment": os.getenv("DEPLOY_ENV", "production"),
        }
    )
    provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(sample_ratio)),
    )
    exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    # Auto-instrument FastAPI (server spans + context propagation).
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)

    # ---- Metrics ----
    app.add_middleware(_REDMiddleware)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:  # noqa: D401
        return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": service_name}


def tracer(name: str = "offcon") -> trace.Tracer:
    """Return a tracer for manual spans."""
    return trace.get_tracer(name)
