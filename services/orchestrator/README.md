# Lab Orchestrator

The orchestrator is the **core** of Offensive Conditions. It spawns, manages, and tears down lab instances — pods on Kubernetes for Linux boxes/challenges, KVM VMs on Proxmox for Windows machines and AD labs.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  HTTP API (Gin)                                              │
│  POST /v1/instances           → spawn new lab               │
│  GET  /v1/instances/:id       → status, connection info     │
│  DELETE /v1/instances/:id     → tear down                   │
│  POST /v1/instances/:id/reset → reset to clean state        │
│  GET  /v1/instances/:id/logs  → recent stdout/stderr        │
│  GET  /v1/capacity            → cluster capacity snapshot    │
└──────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Service layer                                               │
│  • Validates request (machine exists, user has tier access)  │
│  • Checks quota: per-user concurrent instances, monthly hrs  │
│  • Generates user-specific flag (HMAC)                       │
│  • Picks backend (k8s/proxmox) by machine.os_type            │
│  • Persists instance row, transitions state machine          │
└──────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Backend (Kubernetes OR Proxmox)                             │
│  k8s: creates LabInstance CRD → operator reconciles → Pod    │
│  proxmox: clones VM template → starts → assigns VLAN        │
└──────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Network controller                                          │
│  • Allocates /30 subnet from per-user /24 pool               │
│  • Programs firewall: user VPN tunnel → instance only       │
│  • Returns connection info: IP, expires_at                   │
└──────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────┐
│  Lifecycle worker (separate process: cmd/reaper)             │
│  • Scans for instances past TTL → graceful shutdown          │
│  • Health-checks running instances → mark unhealthy/restart  │
│  • Garbage-collects orphaned k8s pods / proxmox VMs          │
└──────────────────────────────────────────────────────────────┘
```

## Three binaries

| Binary | Purpose |
|--------|---------|
| `cmd/server` | HTTP + gRPC API serving user spawn/status requests |
| `cmd/reaper` | Background worker scanning for expired instances |
| `cmd/operator` | Kubernetes operator reconciling `LabInstance` CRDs |

## Stack

- **Language:** Go 1.22
- **DB:** PostgreSQL 16 (`lab` schema)
- **Cache:** Redis (instance state, capacity counters)
- **Events:** Kafka (instance lifecycle events for analytics, scoring)
- **K8s client:** controller-runtime (sigs.k8s.io)
- **Proxmox:** REST API client (hand-rolled, no SDK)
- **Auth:** gRPC client → auth-service for JWT validation
- **Logging:** zerolog structured JSON

## State Machine

```
                  ┌─────────┐
                  │ PENDING │  ← row created in DB
                  └────┬────┘
                       ↓
                  ┌──────────┐
                  │ SPAWNING │  ← backend (k8s/proxmox) provisioning
                  └────┬─────┘
                       ↓
              ┌────────┴────────┐
              ↓                 ↓
         ┌─────────┐       ┌────────┐
         │ RUNNING │       │ FAILED │
         └────┬────┘       └────────┘
              ↓
       ┌──────┴──────┐
       ↓             ↓
  ┌──────────┐  ┌──────────┐
  │TERMINATED│  │ EXPIRED  │  (TTL reached)
  └──────────┘  └──────────┘
```

## Configuration

```
APP_ENV=production
HTTP_PORT=8002
GRPC_PORT=9002

# Database
DB_HOST=postgres.databases.svc
DB_NAME=offcon
DB_USER=svc_orchestrator
DB_PASSWORD=<vault>

# Redis
REDIS_ADDR=redis:6379

# Auth service
AUTH_GRPC_ENDPOINT=auth.offcon-auth.svc:9001
AUTH_JWT_PUBLIC_KEY_PATH=/secrets/auth-jwt-public.pem

# Kubernetes backend
K8S_IN_CLUSTER=true                  # false → use KUBECONFIG path
K8S_KUBECONFIG=/secrets/kubeconfig   # optional override
K8S_LAB_NAMESPACE=lab-instances      # where lab pods land
K8S_RUNTIME_CLASS=gvisor             # sandboxed runtime

# Proxmox backend
PROXMOX_ENDPOINT=https://pve01.lab.offensiveconditions.org:8006/api2/json
PROXMOX_USER=orchestrator@pve
PROXMOX_TOKEN_ID=<vault>
PROXMOX_TOKEN_SECRET=<vault>
PROXMOX_DEFAULT_NODE=pve01
PROXMOX_STORAGE=local-lvm

# Network
VPN_USER_SUBNET_BASE=10.10.0.0/16   # per-user /24 carved from this
WIREGUARD_API=http://wg-controller.network.svc:8090

# Flag generation
FLAG_HMAC_SECRET=<vault>
FLAG_PREFIX=OFFCON

# Lifecycle
INSTANCE_DEFAULT_TTL=8h
INSTANCE_MAX_TTL=24h
REAPER_INTERVAL=60s

# Kafka events
KAFKA_BROKERS=kafka.events.svc:9092
KAFKA_TOPIC_INSTANCE_EVENTS=instance.events
```

## API Endpoints (summary)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/instances` | ✓ | Spawn a new lab instance |
| GET | `/v1/instances/:id` | ✓ | Get instance status + connection info |
| DELETE | `/v1/instances/:id` | ✓ | Tear down instance |
| POST | `/v1/instances/:id/reset` | ✓ | Reset to clean state |
| POST | `/v1/instances/:id/extend` | ✓ | Extend TTL (within max) |
| GET | `/v1/instances/:id/logs` | ✓ | Recent stdout/stderr |
| GET | `/v1/instances/active` | ✓ | List user's running instances |
| GET | `/v1/capacity` | admin | Cluster capacity snapshot |
| POST | `/v1/admin/instances/:id/force-kill` | admin | Bypass graceful shutdown |

## Security boundaries

- Lab containers run with `runtimeClass: gvisor` (user-space kernel)
- Network policies: lab pods can only egress through VPN gateway
- No SSH/exec into running labs from orchestrator process
- Flags stored as HMAC hash in DB; raw flag injected via env at spawn time
- Per-user VLAN isolation enforced at network controller level

See `internal/network/` for network isolation details.
