# OFFCON — Observability Stack (Phase 15)

Full production observability for the OFFCON platform: **metrics**, **logs**,
**traces**, and **alerting**, wired together so you can pivot between all three
with one click.

```
                          ┌─────────────────┐
   services (Go/Py/Node) ─┤ OTel Collector  ├─► Tempo (traces) ─┐
        │  /metrics       └────────┬────────┘                   │
        │                          │ remote-write               │ service graph +
        ▼                          ▼                            │ span metrics
   Prometheus ◄───────────── (RED metrics) ◄────────────────────┘
        │                                            
        │  logs (stdout)                             
        ▼                                            
   Promtail ──► Loki                                 
        │                                            
        └──────────────► Grafana ◄──── AlertManager ──► Slack / PagerDuty
                       (dashboards +    (routing,
                        correlation)     inhibition)
```

## Components

| Component | Role | Version |
|-----------|------|---------|
| **Prometheus** | Metrics storage + alerting rules (30-day retention) | v3.0.1 |
| **Grafana** | Dashboards + unified query across all three signals | 11.4.0 |
| **Loki** | Log aggregation (S3-backed, 30-day) | 3.3.2 |
| **Promtail** | Per-node log shipper (DaemonSet) | 3.3.2 |
| **Tempo** | Distributed tracing + metrics-from-traces (S3-backed, 14-day) | 2.6.1 |
| **OTel Collector** | Telemetry pipeline: enrich, tail-sample, fan out | 0.116.0 |
| **AlertManager** | Alert routing, grouping, inhibition | v0.28.0 |

## The correlation story (why this is more than 4 separate tools)

- **Metric → Trace:** latency-histogram exemplars in Grafana link straight to
  the exact trace that was slow.
- **Trace → Logs:** a span links to all logs for that `trace_id` in Loki.
- **Trace → Metrics:** a span links to the RED metrics for its service.
- **Log → Trace:** a `trace_id` in any log line is a clickable link to Tempo.
- **Traces → Metrics (automatic):** Tempo's metrics-generator produces request
  rate / error / duration **and a live service map** from spans — no extra code.

## What's monitored

- **RED metrics** (Rate, Errors, Duration) for every HTTP + gRPC endpoint
- **Runtime**: Go goroutines/heap/GC, Python/Node process stats
- **Infra**: Postgres, Redis, NATS, node CPU/mem/disk, container resources
- **Istio mesh**: request volume, 5xx, mTLS cert expiry, circuit breakers, rate limits
- **Business KPIs**: signups, MRR, lab spawns, flag submissions, payments, CTF solves

## Alerting

`prometheus/rules/` defines ~40 alerts across availability, latency, errors,
saturation, datastores, gateway, and business KPIs — plus log-pattern alerts in
`loki/rules/` (panics, brute-force, OOM). Routed by team + severity:

- **critical** → PagerDuty (page on-call) + Slack
- **security/billing/growth/platform** → their Slack channels
- Inhibition rules suppress downstream noise (e.g. don't alert on latency when
  the service is already down).

## Run locally

```bash
docker compose -f docker-compose.observability.yml up -d
open http://localhost:3000     # Grafana — admin / admin
```

Services send OTLP traces to `localhost:4317` and expose `/metrics` for scraping.

## Deploy to Kubernetes

```bash
# 1. Create secrets (see docs/SECRETS.md)
# 2. Apply the stack — ConfigMaps are generated from the real config files
kubectl apply -k k8s/
```

## Instrument a service

Each language has a drop-in library in `instrumentation/`:

**Go**
```go
shutdown, _ := observability.Init(ctx, observability.Config{ServiceName: "auth-svc", Tier: "core"})
defer shutdown(ctx)
mux.Handle("/metrics", observability.MetricsHandler())
// wrap HTTP: observability.HTTPMiddleware(routePattern)
// wrap gRPC: grpc.UnaryInterceptor(observability.UnaryServerInterceptor())
```

**Python (FastAPI)**
```python
from offcon_observability import setup_observability
setup_observability(app, service_name="content-svc", tier="content")
```

**Node (Fastify)**
```ts
import { setupObservability } from "@offcon/observability";
await setupObservability(app, { serviceName: "payment-svc", tier: "billing" });
```

All three emit identical metric names, so the same Grafana dashboards work
across every service regardless of language.
