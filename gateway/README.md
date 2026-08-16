# Offensive Conditions — API Gateway & Service Mesh

This directory contains the edge + mesh layer for the Offensive Conditions
platform. It has two distinct concerns:

1. **North-South**: Public clients (browsers, mobile, third parties) hit
   `https://api.offensiveconditions.org`. An Istio IngressGateway terminates TLS and
   routes to internal services via `VirtualService` definitions.
2. **East-West**: All internal service-to-service traffic flows through
   Envoy sidecars injected by Istio. mTLS is enforced via `PeerAuthentication`,
   and authorization between services is restricted via `AuthorizationPolicy`.

Everything is GitOps-managed: this folder is the source of truth.

## Why a dedicated gateway

Per-service auth + CORS + rate limiting was making each service carry the
same boilerplate. Moving it to the gateway gives us:

- One place to verify JWTs (the auth-svc `ext_authz` filter)
- One place to enforce per-route rate limits (Redis-backed)
- One place to inject request IDs + tracing headers
- One place to manage CORS for the SPA
- mTLS between every pod, transparently
- Per-route timeout/retry/circuit-breaker policy without code changes

## Components

```
gateway/
├── deployments/
│   ├── istio/                  Istio control-plane + IngressGateway
│   ├── envoy/                  Standalone Envoy config (when not using Istio)
│   ├── cert-manager/           TLS cert automation
│   ├── routes/                 VirtualServices per service
│   ├── policies/
│   │   ├── authz/              AuthorizationPolicy (who can call whom)
│   │   ├── ratelimit/          EnvoyFilter rate-limit rules + RLS config
│   │   └── security/           PeerAuthentication, RequestAuthentication
│   └── observability/          Telemetry config (Prometheus, tracing, Loki)
├── cmd/healthcheck/            Aux binary: aggregated health endpoint
├── internal/                   Healthcheck-binary internal packages
├── scripts/                    Cert rotation, route validation, smoke tests
└── api/                        Public route registry (the canonical map)
```

## Routes

The canonical, public-facing route table lives in `api/routes.yaml`. This is
the single source of truth — VirtualServices, rate-limit rules, and route
documentation are all generated from this file (see `scripts/validate.sh`).

| Path prefix              | Service          | Auth | Rate limit  |
|--------------------------|------------------|------|-------------|
| `/v1/auth/*`             | auth             | open / authd | 10/min IP |
| `/v1/users/*`, `/v1/me/*`| user-svc         | authd | 60/min user |
| `/v1/teams/*`            | user-svc         | authd | 30/min user |
| `/v1/machines/*`         | content-svc      | authd | 100/min user |
| `/v1/instances/*`        | orchestrator     | authd | 10/min user |
| `/v1/ctf/*`              | ctf-svc          | authd | 60/min user |
| `/v1/forum/*`            | forum-svc        | authd | 60/min user |
| `/v1/writeups/*`         | writeup-svc      | authd | 60/min user |
| `/v1/leaderboards/*`     | scoring          | open  | 60/min IP   |
| `/v1/payments/*`, `/v1/billing/*` | payment-svc | authd | 30/min user |
| `/v1/webhooks/payment`   | payment-svc      | webhook-sig | 100/min IP |
| `/v1/notifications/*`, `/v1/me/notifications/*`, `/v1/me/webhooks/*` | notification-svc | authd | 100/min user |
| `/v1/ws/notifications`   | notification-svc | authd-via-query | n/a |
| `/v1/programs/*`         | bounty-svc       | open / authd | 60/min |
| `/v1/reports/*`, `/v1/me/reports/*` | bounty-svc | authd | 30/min |
| `/v1/admin/*`            | varies (HTTP host header routing) | authd + admin role | 30/min user |
| `/v1/flag/submit`        | flag-verifier    | authd | 20/min user |

## Build & deploy

```bash
# Validate the route table + generate manifests
./scripts/validate.sh

# Apply
kubectl apply -f deployments/istio/
kubectl apply -f deployments/policies/security/
kubectl apply -f deployments/routes/
kubectl apply -f deployments/policies/authz/
kubectl apply -f deployments/policies/ratelimit/
kubectl apply -f deployments/observability/

# Run aggregated healthcheck binary (for the gateway's /healthz aggregator)
make build
./bin/healthcheck
```
