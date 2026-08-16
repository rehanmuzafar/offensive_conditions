# Gateway & Mesh Architecture

## Request lifecycle (north-south)

```
                          Internet
                             │
                             ▼
              ┌──────────────────────────────┐
              │  AWS NLB (LoadBalancer Svc)   │
              └──────────────┬───────────────┘
                             │ :443 TLS
                             ▼
        ┌────────────────────────────────────────┐
        │      Istio IngressGateway (Envoy)        │
        │                                          │
        │  1. TLS termination (cert-manager cert)  │
        │  2. WAF (Coraza Wasm, OWASP CRS)         │
        │  3. RequestAuthentication (verify JWT)   │
        │  4. AuthorizationPolicy (enforce JWT +   │
        │     admin-role checks)                   │
        │  5. Lua filter: strip spoofed identity   │
        │     headers, add security headers        │
        │  6. Local rate limit (per-conn DoS guard)│
        │  7. Global rate limit (RLS gRPC → Redis) │
        │  8. VirtualService routing (path → svc)  │
        │  9. mTLS upgrade to upstream             │
        └──────────────────┬───────────────────────┘
                           │ mTLS (ISTIO_MUTUAL)
                           ▼
        ┌──────────────────────────────────────────┐
        │   Service pod (e.g. bounty-svc)            │
        │   ┌────────────┐      ┌─────────────────┐  │
        │   │   Envoy     │◄────►│  app container   │  │
        │   │  sidecar    │      │  (FastAPI/Go/TS) │  │
        │   └────────────┘      └─────────────────┘  │
        │   - DestinationRule: conn pool, outlier     │
        │     detection (circuit breaking)            │
        │   - Telemetry: trace span, metrics          │
        └──────────────────────────────────────────┘
```

## Why each layer

| Layer | Purpose | Failure mode |
|-------|---------|--------------|
| NLB | L4 LB, cross-zone | n/a (AWS-managed) |
| TLS termination | One cert, ECDSA, auto-renewed | cert-manager renews 15d early |
| WAF | Block injection/scanners pre-routing | detection+block, PL1 |
| RequestAuth | Validate JWT signature + claims | invalid token → claims absent |
| AuthzPolicy | Enforce presence + roles | deny by default for protected |
| Lua filter | Anti-spoofing + sec headers | always-on |
| Local RL | Cheap per-connection flood guard | 2000 rps/conn bucket |
| Global RL | Per-user + per-IP fairness | **fail-open** (availability) |
| VirtualService | Path → service routing | 404 if unmatched |
| mTLS | Encrypt + authenticate east-west | STRICT, no plaintext |
| DestinationRule | Pool + circuit-break | eject after N 5xx |

## Identity flow

1. Client logs in → `auth-svc` issues a JWT signed with its private key.
2. JWKS published at `auth-svc:8001/.well-known/jwks.json`.
3. IngressGateway's `RequestAuthentication` fetches + caches the JWKS, verifies
   every Bearer token, and writes validated claims into `x-jwt-payload`.
4. The Lua filter strips any *client-supplied* `x-user-id` / `x-user-roles`
   first, so only gateway-validated identity propagates.
5. Downstream services trust the gateway-set headers (they're behind mTLS and
   the AuthorizationPolicy guarantees no other caller can reach them).

## East-west zero-trust

Every service has a Kubernetes ServiceAccount → a SPIFFE identity:
`cluster.local/ns/offcon/sa/<service>`. A default **deny-all**
`AuthorizationPolicy` in the `offcon` namespace means no service can call
another unless an explicit allow lists its principal. Example: only
`bounty-svc` and `user-svc` may call `payment-svc`.

## Rate limiting

Two tiers:
- **Local** (in-Envoy token bucket): absorbs connection floods at ~zero cost.
- **Global** (Lyft RLS + Redis): coordinated across all gateway replicas.
  Descriptors built from `(path, remote_ip)` and `(path, user_id)`. The
  per-user-id descriptor only fires once the JWT filter has set `x-user-id`,
  so anonymous traffic is limited by IP, authenticated by user.

Limits live in `deployments/policies/ratelimit/ratelimit-service.yaml` as the
RLS config; the human-facing summary is in `api/routes.yaml`.

## The /v1/me/* ordering problem

`/v1/me` belongs to user-svc, but `/v1/me/notifications`, `/v1/me/webhooks`,
`/v1/me/preferences`, `/v1/me/reports`, `/v1/me/payouts` belong to other
services. Istio matches the **longest/most-specific prefix within the set of
VirtualServices bound to a host**. Because all our VS objects bind the same
host (`api.offensiveconditions.org`) and Envoy merges them into one route table ordered by
match specificity, the longer prefixes win. `scripts/validate.py` enforces
that every more-specific prefix carries a lower `priority` number so the
generated ordering can never shadow them.

## Admin sharding

`/v1/admin/*` is not one service — admin endpoints live in whichever service
owns the resource (bounty admin in bounty-svc, broadcast in notification-svc,
etc). The `admin-routes` VirtualService routes by sub-path. The
`require-admin-role` AuthorizationPolicy gates the whole `/v1/admin/*` tree on
a privileged role claim before any of it is reachable.

## Health aggregation

`gateway-healthcheck` is a tiny Go binary that probes all 12 services'
`/livez` in parallel, caches for 5s, and serves a single `/healthz`. The
IngressGateway routes `/healthz` + `/readyz` to it. `RequireAllUp=false`
means the gateway reports healthy if *any* backend is up — operators read the
per-target breakdown to see which is down, while the gateway itself stays in
LB rotation.

## Observability

- **Traces**: 100% sampled at the gateway, 5% mesh-wide, shipped to Jaeger.
  Custom tags: `user_id`, `route`.
- **Metrics**: Istio standard + custom `request_path` / `response_code`
  dimensions → Prometheus.
- **Access logs**: JSON to stdout on every Envoy → scraped to Loki.

These feed Phase 15 (the observability stack).

## Deploy order

```
1. namespaces        (label for injection)
2. cert-manager      (issue TLS)
3. istio operator    (control plane + ingressgateway)
4. service-entries   (register data plane + external SaaS)
5. security policies  (mTLS, JWT, hardening, WAF, DestinationRules)
6. routes            (VirtualServices)
7. authz policies    (edge + east-west)
8. ratelimit         (RLS + EnvoyFilter)
9. observability     (telemetry)
10. healthcheck       (aggregator)
```

`make apply-all` runs this in order.
