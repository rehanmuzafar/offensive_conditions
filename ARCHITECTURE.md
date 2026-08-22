# Offense Conditions — Platform Architecture

> A cybersecurity training and CTF ecosystem combining HackTheBox, TryHackMe, pwn.college, and bug bounty marketplace capabilities.

**Document Version:** 1.0
**Last Updated:** May 2026
**Status:** Foundation Architecture (Pre-Implementation)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Technology Stack](#3-technology-stack)
4. [Service Architecture](#4-service-architecture)
5. [Lab Orchestration Engine](#5-lab-orchestration-engine)
6. [Network Architecture](#6-network-architecture)
7. [Database Design](#7-database-design)
8. [Security Architecture](#8-security-architecture)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [API Design](#10-api-design)
11. [Monitoring & Observability](#11-monitoring--observability)
12. [Development Roadmap](#12-development-roadmap)

---

## 1. Executive Summary

### 1.1 Product Vision
Offense Conditions is an offensive cybersecurity training platform offering:
- **Vulnerable Machines** (HTB-style): Standalone hackable boxes
- **Learning Paths** (THM-style): Guided structured curriculum
- **Dojo Challenges** (pwn.college-style): Modular skill-based exercises
- **Live CTF Events**: Time-bound competitive hacking events
- **Pro Labs**: Enterprise-grade multi-machine environments (Active Directory networks)
- **Bug Bounty Marketplace**: VAPT platform connecting researchers with companies

### 1.2 Architecture Principles
- **Microservices**: Independent, scalable services
- **Security First**: Platform is itself a target — zero-trust internally
- **Isolation**: Per-user network isolation, container/VM sandboxing
- **Horizontal Scalability**: Stateless services, distributed state
- **Hybrid Infrastructure**: Cloud for app, bare metal for compute
- **Event-Driven**: Async messaging for non-critical paths
- **Observable**: Full tracing, metrics, structured logging

### 1.3 Scale Targets (12 months)
| Metric | Target |
|--------|--------|
| Registered Users | 50,000+ |
| Concurrent Lab Instances | 2,000+ |
| Active VPN Connections | 5,000+ |
| Content Items (Machines + Challenges) | 300+ |
| API Requests/sec (peak) | 5,000 |
| Database Size | 500 GB+ |

---

## 2. System Overview

### 2.1 High-Level Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│  Web App (Next.js)  │  VPN Client  │  Pwnbox (Browser VM)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE & GATEWAY LAYER                         │
│      Cloudflare (CDN, WAF, DDoS) → Nginx → API Gateway          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────┐   │
│  │  Auth   │  │  User   │  │ Content │  │ Scoring │  │ CTF  │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └──────┘   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────┐   │
│  │ Payment │  │  Forum  │  │ Bounty  │  │ Writeup │  │ Notif│   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └──────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              ORCHESTRATION LAYER (CRITICAL CORE)                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Lab Orchestrator → K8s API + KVM/Proxmox + VPN Manager    │ │
│  │  Flag Service │ Scheduler │ Network Manager │ TTL Reaper   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                              │
│  PostgreSQL │ Redis │ ClickHouse │ MinIO/S3 │ Kafka │ Vault     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Flow Example (User spawns a machine)

1. User clicks "Spawn" on machine page (Web App)
2. Request → Cloudflare → Nginx → API Gateway
3. Gateway validates JWT → routes to **Orchestrator Service**
4. Orchestrator checks: subscription tier, quota, machine availability
5. Orchestrator queries **Scheduler** → picks best lab node (least loaded)
6. Scheduler issues spawn command:
   - For container machines: K8s API → creates Pod in isolated namespace
   - For VM machines: Proxmox API → clones VM template
7. **Network Manager** allocates: subnet, VLAN, firewall rules
8. **VPN Manager** updates WireGuard config: user can now reach machine IP
9. **Flag Service** generates per-instance flags (user_flag, root_flag)
10. Instance metadata persisted in PostgreSQL, cache in Redis
11. WebSocket pushes status updates to user's browser
12. **TTL Reaper** schedules cleanup at T+2hours

---

## 3. Technology Stack

### 3.1 Frontend
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 14 (App Router) | SSR/SSG, SEO, React ecosystem |
| Language | TypeScript | Type safety, refactoring |
| Styling | TailwindCSS + shadcn/ui | Rapid, consistent UI |
| State | Zustand + TanStack Query | Lightweight, server-state separation |
| Real-time | Socket.IO client | WebSocket abstraction |
| Terminal | xterm.js | Browser-based shell rendering |
| Auth | NextAuth.js (custom provider) | OAuth + JWT |

### 3.2 Backend Services
| Service | Language | Framework | Rationale |
|---------|----------|-----------|-----------|
| Auth | Go | Gin + JWT | Performance critical, high RPS |
| User | Go | Gin | High throughput, simple CRUD |
| Content | Python | FastAPI | Rich ecosystem for content mgmt |
| Lab Orchestrator | Go | Custom + K8s client-go | Concurrency, K8s native |
| Flag Verification | Go | Gin | Crypto-heavy, low latency |
| Scoring | Go | Gin | Real-time leaderboard ops |
| CTF Engine | Python | FastAPI | Flexible event logic |
| Payment | Node.js | Express | Stripe/JazzCash SDKs mature |
| Forum | Python | FastAPI | Rich text handling |
| Notification | Node.js | Express + Socket.IO | WebSocket native |
| Bounty | Python | FastAPI | Complex business logic |
| Writeup | Python | FastAPI | Markdown + media handling |

### 3.3 Data Stores
| Store | Purpose | Notes |
|-------|---------|-------|
| PostgreSQL 16 | Primary OLTP | Per-service schemas, replicated |
| Redis 7 (Cluster) | Cache, sessions, rate limit, leaderboards | Sorted sets for rankings |
| ClickHouse | Analytics, logs, time-series | Submission analytics, audit logs |
| MinIO (S3-compatible) | Object storage | Machine images, writeup media |
| Kafka | Event bus | Spawn events, submissions, audit |
| HashiCorp Vault | Secrets | Credentials, signing keys |

### 3.4 Infrastructure
| Layer | Technology | Notes |
|-------|-----------|-------|
| Container Runtime | containerd + gVisor | Hardened isolation for labs |
| Orchestration | Kubernetes (K3s or full) | Lab pods + app services |
| VM Hypervisor | Proxmox VE (KVM) | Windows/AD machines, Pro Labs |
| Service Mesh | Istio | mTLS, observability, traffic mgmt |
| VPN | WireGuard | 3x faster than OpenVPN, modern crypto |
| Networking | Calico + Multus | Multi-network CNI for lab isolation |
| Load Balancer | HAProxy + Nginx | App ingress |
| CDN/Edge | Cloudflare | DDoS, WAF, asset caching |
| IaC | Terraform + Ansible | Cloud + bare metal provisioning |
| CI/CD | GitLab CI / GitHub Actions | Build, test, deploy |
| Registry | Harbor | Container image registry |

### 3.5 Observability
| Tool | Purpose |
|------|---------|
| Prometheus | Metrics collection |
| Grafana | Dashboards |
| Loki | Log aggregation |
| Tempo / Jaeger | Distributed tracing |
| OpenTelemetry | Instrumentation standard |
| Sentry | Error tracking |
| Falco | Runtime security monitoring |

---

## 4. Service Architecture

### 4.1 Service Inventory

#### 4.1.1 Auth Service
**Responsibility:** User authentication, token issuance, session management.

**Endpoints:**
- `POST /auth/register` — Account creation
- `POST /auth/login` — Credential check, JWT issuance
- `POST /auth/refresh` — Token refresh
- `POST /auth/logout` — Session invalidation
- `POST /auth/2fa/enable` — TOTP setup
- `POST /auth/2fa/verify` — TOTP verification
- `POST /auth/oauth/{provider}` — OAuth flow (Google, GitHub)
- `POST /auth/password/reset` — Password reset flow

**Data:** users, sessions, refresh_tokens, 2fa_secrets, oauth_links

**Key Decisions:**
- JWT (RS256) — 15min access token, 7-day refresh token
- Argon2id for password hashing
- TOTP for 2FA (RFC 6238)
- Rate limiting per IP + per account

#### 4.1.2 User Service
**Responsibility:** Profile management, teams, subscriptions, preferences.

**Endpoints:**
- `GET /users/me` — Current user profile
- `PATCH /users/me` — Update profile
- `GET /users/{id}` — Public profile
- `POST /teams` — Create team
- `POST /teams/{id}/invite` — Invite member
- `GET /subscriptions` — User's subscription details
- `POST /subscriptions/upgrade` — Tier upgrade

**Data:** profiles, teams, team_members, subscriptions, achievements

#### 4.1.3 Content Service
**Responsibility:** Catalog of machines, challenges, learning paths, dojos.

**Endpoints:**
- `GET /machines` — List with filters (difficulty, OS, category)
- `GET /machines/{id}` — Machine details
- `GET /challenges` — List challenges
- `GET /paths` — Learning paths catalog
- `GET /paths/{id}/modules` — Modules in a path
- `GET /dojos` — Dojo catalog (pwn.college-style)
- `GET /dojos/{id}/modules/{moduleId}/levels` — Hierarchical content

**Data:** machines, challenges, paths, path_modules, dojos, dojo_levels, tags, prerequisites

#### 4.1.4 Lab Orchestrator Service (CRITICAL)
**Responsibility:** Spawn/manage/terminate lab instances.

**Endpoints:**
- `POST /instances` — Spawn instance (machine_id or challenge_id)
- `GET /instances/{id}` — Status, IP, time remaining
- `POST /instances/{id}/extend` — Extend TTL (limited)
- `POST /instances/{id}/reset` — Restart machine
- `DELETE /instances/{id}` — Terminate
- `GET /instances/active` — User's running instances

**Internal:**
- Communicates with K8s API for container labs
- Communicates with Proxmox API for VM labs
- Coordinates with VPN Manager + Network Manager
- Emits events to Kafka

**Detailed design in Section 5.**

#### 4.1.5 Flag Verification Service
**Responsibility:** Validate submitted flags, prevent cheating.

**Endpoints:**
- `POST /submissions` — Submit flag → returns points + position change
- `GET /submissions/me` — Own submission history

**Anti-cheat logic:**
- Per-instance flag generation (HMAC-SHA256 with server secret)
- Rate limiting: 5 wrong attempts → cooldown
- Submission velocity analysis (suspiciously fast solves)
- IP correlation across accounts
- Flag format: `OFFCON{base64(hmac(machine_id || user_id || salt))}`

**Data:** submissions, flag_attempts, anti_cheat_flags

#### 4.1.6 Scoring Service
**Responsibility:** Points calculation, rankings, achievements.

**Endpoints:**
- `GET /leaderboard/global` — Top 100 globally
- `GET /leaderboard/country/{code}` — Country leaderboard
- `GET /leaderboard/teams` — Team rankings
- `GET /users/{id}/rank` — Specific user's rank

**Algorithm:**
- Static points per machine + decay for late solves
- Streak bonuses
- First-blood bonus (first 3 solvers get +)
- Redis Sorted Sets for O(log n) rank operations

**Data:** points_history, rankings (Redis), achievement_unlocks

#### 4.1.7 CTF Engine Service
**Responsibility:** Time-bound competitive events.

**Endpoints:**
- `POST /ctf/events` — Create event (admin)
- `POST /ctf/events/{id}/register` — User joins
- `GET /ctf/events/{id}/challenges` — Event challenges (gated by start time)
- `POST /ctf/events/{id}/submit` — Event-specific flag submission
- `GET /ctf/events/{id}/scoreboard` — Live scoreboard
- `GET /ctf/events/{id}/freeze` — Frozen scoreboard (last hour)

**Features:**
- Team-based or solo events
- Dynamic scoring (decreases with more solvers)
- Categories: web, pwn, crypto, forensics, reverse, misc
- Hints (with point deduction)
- First-blood announcements
- Frozen scoreboard last hour

#### 4.1.8 Payment Service
**Responsibility:** Subscriptions, one-off purchases, invoices.

**Endpoints:**
- `POST /payments/checkout` — Initiate checkout
- `POST /payments/webhook/stripe` — Stripe events
- `POST /payments/webhook/jazzcash` — JazzCash events
- `GET /payments/invoices` — User invoices

**Integrations:**
- Stripe (international)
- JazzCash + EasyPaisa (Pakistan)
- PayPal (backup)
- Crypto (USDT/BTC via NOWPayments — for unbanked users)

**Subscription Tiers:**
- Free: 2 active machines, 5 challenges/day, no Pro Labs
- VIP ($14/mo): Unlimited machines, all retired content, Pwnbox
- VIP+ ($25/mo): + Pro Labs, priority queue, advanced analytics
- Team/Enterprise: Custom pricing

#### 4.1.9 Forum Service
**Responsibility:** Discussion, machine comments, support.

**Endpoints:**
- `GET /forum/categories` — Forum structure
- `POST /forum/threads` — Create thread
- `POST /forum/threads/{id}/replies` — Reply
- `POST /forum/posts/{id}/vote` — Upvote/downvote

**Features:**
- Markdown + code highlighting
- Spoiler tags (`||hidden||`)
- Image embedding
- Reputation system tied to upvotes

#### 4.1.10 Writeup Service
**Responsibility:** User-submitted solutions (post-retirement).

**Endpoints:**
- `POST /writeups` — Submit writeup (only after machine retires)
- `GET /writeups?machine={id}` — List writeups for machine
- `POST /writeups/{id}/approve` — Admin approval

**Rules:**
- Writeups only published after machine retires from active rotation
- Quality moderation (admin review)
- Featured writeups earn rewards

#### 4.1.11 Bounty Service (Phase 4)
**Responsibility:** Bug bounty marketplace.

**Endpoints:**
- `POST /bounty/programs` — Company creates program
- `GET /bounty/programs` — List active programs
- `POST /bounty/reports` — Researcher submits vulnerability
- `POST /bounty/reports/{id}/triage` — Company triages
- `POST /bounty/reports/{id}/payout` — Approve payout

**Complexity Note:** This is essentially a separate product. Defer to Phase 4.

#### 4.1.12 Notification Service
**Responsibility:** Real-time + async notifications.

**Channels:**
- WebSocket (in-app, real-time)
- Email (transactional via SendGrid/AWS SES)
- Discord/Slack webhooks (for teams)
- Push notifications (mobile app, future)

### 4.2 Inter-Service Communication

**Synchronous:** gRPC for internal service-to-service (lower latency than REST)
**Asynchronous:** Kafka for events (decoupling, replay capability)
**External:** REST (JSON) via API Gateway

**Critical Event Topics:**
- `lab.instance.spawned`
- `lab.instance.terminated`
- `submission.flag.accepted`
- `submission.flag.rejected`
- `subscription.upgraded`
- `ctf.event.started`
- `payment.completed`
- `security.alert`

---

## 5. Lab Orchestration Engine

**This is the most critical and complex component.** It is what differentiates a real platform from a tutorial site.

### 5.1 Design Goals
1. **Multi-tenant isolation**: Zero cross-user access
2. **Resource efficiency**: Pack lab instances densely
3. **Sub-30-second spawn time**: For container labs
4. **Reliable cleanup**: No resource leaks
5. **Horizontally scalable**: Add compute nodes dynamically

### 5.2 Compute Backends

#### 5.2.1 Container Backend (Kubernetes)
**Used for:** Single-host Linux challenges, web apps, easy/medium boxes, dojo levels.

**Architecture:**
- Dedicated K8s cluster for labs (separate from app cluster)
- Each user has a namespace: `user-{uuid}`
- NetworkPolicy enforces isolation between namespaces
- gVisor runtime class for kernel-level sandboxing
- Resource limits: 0.5 CPU, 512MB RAM per pod (default)
- Custom Operator: `LabInstance` CRD

**LabInstance CRD Example:**
```yaml
apiVersion: offensiveconditions.org/v1
kind: LabInstance
metadata:
  name: instance-abc123
  namespace: user-xyz789
spec:
  machineId: machine-linux-easy-01
  imageRef: harbor.offensiveconditions.org/machines/blue:v3
  userId: xyz789
  ttlSeconds: 7200
  resources:
    cpu: "500m"
    memory: "512Mi"
  network:
    subnetCIDR: 10.10.5.0/24
    flags:
      - userFlag: <hmac-sha256>
        rootFlag: <hmac-sha256>
status:
  phase: Running
  ip: 10.10.5.42
  spawnedAt: 2026-05-21T10:00:00Z
  expiresAt: 2026-05-21T12:00:00Z
```

**Why gVisor over runc:**
Standard Docker/runc shares the host kernel — a container escape = root on lab node = pivot point. gVisor adds a userspace kernel between container and host, dramatically reducing kernel attack surface. Worth the small perf hit.

#### 5.2.2 VM Backend (Proxmox / KVM)
**Used for:** Windows machines, Active Directory environments, Pro Labs, anything needing full OS.

**Architecture:**
- Proxmox VE cluster on dedicated bare metal
- Template-based: Each machine = base VM template, clone on spawn (linked clones for speed)
- Per-user VLAN tagging via Open vSwitch
- VM resource: 2 CPU, 4GB RAM (Linux), 2 CPU, 6GB RAM (Windows)
- Snapshot-based reset (instant rollback to clean state)

**Spawn Flow:**
1. Orchestrator calls Proxmox API: `clone template-{machineId} → vm-{instanceId}`
2. Apply per-instance config: hostname, flags injected via cloud-init / unattended.xml
3. Attach to user's VLAN
4. Start VM, wait for QEMU guest agent → readiness signal
5. Return IP to orchestrator

**Pro Labs (Multi-Machine AD):**
- Each Pro Lab = 5-15 VMs in a single user's VLAN
- Pre-configured AD domain, vulnerabilities, attack paths
- Examples: "Dante" (small AD), "Offshore" (mid), "Cybernetics" (large)

### 5.3 Scheduler

**Algorithm:** Bin-packing with constraints
- Track per-node: CPU available, RAM available, network bandwidth
- Constraints: machine type (container vs VM), affinity rules
- Strategy: Least-loaded node with capacity, prefer warm nodes (already running similar images)

**Failure Handling:**
- Node fails → instances rescheduled (state lost — labs are ephemeral)
- Spawn failure → retry on different node, max 3 attempts
- Capacity exhausted → queue user (max wait 5 min) → alert ops

### 5.4 Network Manager

**Responsibility:** Allocate per-user network, manage firewall rules.

**Per-user network:**
- VLAN ID assigned (range: 1000-4000, supports 3000 concurrent labs per cluster)
- Subnet from /16 pool: `10.X.0.0/24` where X = VLAN suffix
- iptables/nftables rules:
  - Allow: user's VPN IP → user's lab subnet
  - Deny: any cross-namespace/cross-VLAN traffic
  - Deny: lab → internet (except DNS, NTP, allowlisted)
  - Deny: lab → platform infra (10.0.0.0/8 platform range)

**VPN Routing:**
- WireGuard server per region (US, EU, Asia)
- User connects with unique key
- AllowedIPs dynamically updated when instance spawns
- Routes: user → wg-server → switch fabric → lab VLAN

### 5.5 Flag Service

**Per-instance flag generation:**
```
user_flag  = "OFFCON{" + base64(HMAC-SHA256(secret, machine_id || user_id || "user" || salt)) + "}"
root_flag  = "OFFCON{" + base64(HMAC-SHA256(secret, machine_id || user_id || "root" || salt)) + "}"
```

**Injection:**
- Container: flag written to `/root/root.txt` and `/home/user/user.txt` at pod startup via init container
- VM: flag injected via cloud-init (Linux) or unattended setup script (Windows)

**Verification:**
- User submits flag → Flag Service recomputes expected value → compares
- Constant-time comparison to prevent timing attacks
- Result emitted to Kafka → Scoring Service updates points

**Anti-cheat:**
- Same flag submitted by multiple users → all flagged for review (flag-sharing detection)
- Flag submitted without spawning instance → suspicious
- Flag submitted before any reasonable solve time → suspicious
- ML-based anomaly detection (Phase 2)

### 5.6 TTL Reaper

**Background worker:**
- Every 60s: query DB for expired instances
- For each: call K8s/Proxmox API to terminate, cleanup network, log session, free resources
- Grace period: 5 min warning to user before expiration
- Self-healing: orphaned resources (DB has no record but compute has running) cleaned daily

---

## 6. Network Architecture

### 6.1 Network Segmentation

```
┌─────────────────────────────────────────────────────────┐
│              PUBLIC INTERNET                            │
└─────────────────────────────────────────────────────────┘
              │                          │
              ▼                          ▼
      ┌───────────────┐         ┌────────────────┐
      │  CDN/WAF      │         │  VPN Endpoints │
      │  (Cloudflare) │         │  (WireGuard)   │
      └───────┬───────┘         └────────┬───────┘
              │                          │
              ▼                          ▼
      ┌───────────────────────────────────────────┐
      │     EDGE NETWORK (Public-facing LBs)      │
      └─────────────────────┬─────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌─────────┐  ┌──────────┐  ┌──────────────┐
        │ Platform│  │  Lab     │  │ Management   │
        │ Network │  │ Network  │  │ Network      │
        │ 10.0/16 │  │ 10.X/16  │  │ 10.255/16    │
        └─────────┘  └──────────┘  └──────────────┘
        (Services,    (Per-user      (Bastion, ops,
         DBs)          isolated)      monitoring)
```

### 6.2 Network Zones

| Zone | CIDR | Purpose | Access |
|------|------|---------|--------|
| Public Edge | Public IPs | LBs, VPN endpoints | Internet |
| Platform | 10.0.0.0/16 | App services, DBs | Internal only |
| Lab Pool | 10.1.0.0/12 | User lab subnets | VPN-gated |
| Management | 10.255.0.0/16 | Bastion, monitoring | Ops VPN only |
| Storage | 10.254.0.0/16 | NAS, backup | Internal only |

### 6.3 VPN Architecture (WireGuard)

**Multi-region deployment:**
- `vpn-us-east.offensiveconditions.org` (Hetzner US)
- `vpn-eu-central.offensiveconditions.org` (Hetzner Germany)
- `vpn-asia-south.offensiveconditions.org` (Pakistan/Singapore)

**Per-user config (dynamic generation):**
```ini
[Interface]
PrivateKey = <user_priv>
Address = 10.100.<userId>.1/32
DNS = 10.100.0.1

[Peer]
PublicKey = <server_pub>
Endpoint = vpn-us-east.offensiveconditions.org:51820
AllowedIPs = 10.1.0.0/12   # Lab pool
PersistentKeepalive = 25
```

**Dynamic AllowedIPs:**
When a user spawns an instance at `10.1.42.5`, the VPN Manager updates:
- Server-side: adds user's pub key → routes to `10.1.42.5/32`
- Client config remains the same (allows entire `10.1.0.0/12`)
- Network manager ensures only the user's subnet is actually reachable via firewall

### 6.4 Egress Filtering

**Lab outbound rules:**
- Allow: DNS (53), NTP (123), HTTP/HTTPS to allowlist (apt mirrors, common CDN)
- Deny: Everything else
- Why: prevent attackers from using your platform to attack third parties (illegal liability), prevent C2 callbacks to attacker infra

**Detection:**
- Monitor outbound traffic per lab namespace
- Alert on anomalous patterns (high volume, beaconing, DNS tunneling indicators)

---

## 7. Database Design

### 7.1 Schema-per-Service Pattern

Each microservice owns its schema. No cross-service joins — communicate via API/events.

### 7.2 Core Tables (Logical Schema)

#### auth schema
```sql
CREATE TABLE auth.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    username        CITEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,         -- argon2id
    email_verified  BOOLEAN DEFAULT FALSE,
    tfa_enabled     BOOLEAN DEFAULT FALSE,
    tfa_secret      TEXT,                  -- encrypted via Vault
    status          TEXT DEFAULT 'active', -- active|suspended|banned
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    INDEX idx_email (email),
    INDEX idx_username (username)
);

CREATE TABLE auth.refresh_tokens (
    id              UUID PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN DEFAULT FALSE,
    ip_address      INET,
    user_agent      TEXT,
    INDEX idx_user (user_id)
);

CREATE TABLE auth.oauth_links (
    id              UUID PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id),
    provider        TEXT NOT NULL,     -- google|github|discord
    provider_id     TEXT NOT NULL,
    UNIQUE (provider, provider_id)
);
```

#### user schema
```sql
CREATE TABLE users.profiles (
    user_id         UUID PRIMARY KEY,  -- mirrors auth.users.id
    display_name    TEXT,
    bio             TEXT,
    avatar_url      TEXT,
    country_code    CHAR(2),
    timezone        TEXT,
    public_profile  BOOLEAN DEFAULT TRUE,
    discord_handle  TEXT,
    github_handle   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users.subscriptions (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    tier            TEXT NOT NULL,     -- free|vip|vip_plus|team
    status          TEXT NOT NULL,     -- active|past_due|canceled
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    stripe_subscription_id TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
);

CREATE TABLE users.teams (
    id              UUID PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    owner_id        UUID NOT NULL,
    description     TEXT,
    is_private      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users.team_members (
    team_id         UUID REFERENCES users.teams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    role            TEXT NOT NULL,     -- owner|admin|member
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);
```

#### content schema
```sql
CREATE TABLE content.machines (
    id              UUID PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    os              TEXT NOT NULL,         -- linux|windows|other
    difficulty      TEXT NOT NULL,         -- easy|medium|hard|insane
    category        TEXT,                  -- web|pwn|crypto|...
    description     TEXT,
    image_ref       TEXT NOT NULL,         -- harbor registry path
    image_type      TEXT NOT NULL,         -- container|vm
    base_points     INT NOT NULL,
    status          TEXT DEFAULT 'active', -- draft|active|retired
    creator_id      UUID,
    released_at     TIMESTAMPTZ,
    retired_at      TIMESTAMPTZ,
    avg_solve_time  INTERVAL,
    user_rating     NUMERIC(3,2),
    INDEX idx_status (status),
    INDEX idx_difficulty (difficulty)
);

CREATE TABLE content.machine_tags (
    machine_id      UUID REFERENCES content.machines(id) ON DELETE CASCADE,
    tag             TEXT,
    PRIMARY KEY (machine_id, tag)
);

CREATE TABLE content.challenges (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    difficulty      TEXT NOT NULL,
    description     TEXT,
    files           JSONB,                 -- downloadable artifacts
    points          INT NOT NULL,
    requires_instance BOOLEAN DEFAULT FALSE,
    image_ref       TEXT,                  -- if instance-based
    status          TEXT DEFAULT 'active'
);

CREATE TABLE content.learning_paths (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    estimated_hours INT,
    difficulty      TEXT,
    required_tier   TEXT DEFAULT 'free',
    cover_image     TEXT
);

CREATE TABLE content.path_modules (
    id              UUID PRIMARY KEY,
    path_id         UUID REFERENCES content.learning_paths(id) ON DELETE CASCADE,
    sequence        INT NOT NULL,
    title           TEXT,
    content_md      TEXT,                  -- markdown lesson
    machine_id      UUID,                  -- optional linked machine
    challenge_id    UUID,                  -- optional linked challenge
    UNIQUE (path_id, sequence)
);

CREATE TABLE content.dojos (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    description     TEXT,
    award_emoji     TEXT
);

CREATE TABLE content.dojo_modules (
    id              UUID PRIMARY KEY,
    dojo_id         UUID REFERENCES content.dojos(id) ON DELETE CASCADE,
    sequence        INT,
    name            TEXT
);

CREATE TABLE content.dojo_levels (
    id              UUID PRIMARY KEY,
    module_id       UUID REFERENCES content.dojo_modules(id) ON DELETE CASCADE,
    sequence        INT,
    name            TEXT,
    image_ref       TEXT,                  -- container per level
    flag_template   TEXT,
    points          INT
);
```

#### orchestrator schema
```sql
CREATE TABLE lab.instances (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    machine_id      UUID,
    challenge_id    UUID,
    dojo_level_id   UUID,
    backend         TEXT NOT NULL,         -- container|vm
    node_id         TEXT,                  -- k8s node or proxmox node
    pod_name        TEXT,                  -- if container
    vm_id           TEXT,                  -- if VM
    vlan_id         INT,
    subnet          CIDR,
    instance_ip     INET,
    status          TEXT NOT NULL,         -- spawning|running|terminating|terminated|failed
    spawned_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    terminated_at   TIMESTAMPTZ,
    flags_json      JSONB,                 -- {user_flag_hash, root_flag_hash}
    metadata        JSONB,
    INDEX idx_user_status (user_id, status),
    INDEX idx_expires (expires_at) WHERE status = 'running'
);

CREATE TABLE lab.nodes (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,         -- k8s|proxmox
    region          TEXT,
    cpu_total       INT,
    cpu_used        INT,
    mem_total_mb    INT,
    mem_used_mb     INT,
    status          TEXT,                  -- ready|draining|down
    last_heartbeat  TIMESTAMPTZ
);
```

#### scoring schema
```sql
CREATE TABLE scoring.submissions (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    instance_id     UUID,
    machine_id      UUID,
    challenge_id    UUID,
    flag_type       TEXT,                  -- user|root|challenge
    submitted_flag  TEXT NOT NULL,         -- hashed for storage
    accepted        BOOLEAN NOT NULL,
    points_awarded  INT,
    is_first_blood  BOOLEAN DEFAULT FALSE,
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user (user_id),
    INDEX idx_user_machine_type (user_id, machine_id, flag_type)
);

CREATE TABLE scoring.point_history (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    event_type      TEXT,                  -- machine_solve|challenge_solve|streak|first_blood
    points          INT NOT NULL,          -- can be negative (decay)
    reference_id    UUID,                  -- the machine/challenge/event
    occurred_at     TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_user_time (user_id, occurred_at DESC)
);

CREATE TABLE scoring.achievements (
    id              UUID PRIMARY KEY,
    code            TEXT UNIQUE,           -- e.g. "first_machine_pwned"
    name            TEXT,
    description     TEXT,
    icon_url        TEXT,
    points          INT DEFAULT 0
);

CREATE TABLE scoring.user_achievements (
    user_id         UUID,
    achievement_id  UUID REFERENCES scoring.achievements(id),
    unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);
```

### 7.3 Redis Data Structures

```
# Global leaderboard (sorted set by points)
ZADD leaderboard:global <points> <user_id>
ZREVRANGE leaderboard:global 0 99 WITHSCORES    # Top 100

# Country leaderboard
ZADD leaderboard:country:PK <points> <user_id>

# User session
SET session:<sid> "<json>" EX 86400

# Rate limit (per user, per endpoint)
INCR ratelimit:user:<uid>:auth.login
EXPIRE ratelimit:user:<uid>:auth.login 60

# Flag submission rate limit
INCR ratelimit:submit:<uid>
EXPIRE ratelimit:submit:<uid> 300

# Active instances counter (for quota enforcement)
SADD active_instances:<uid> <instance_id>
SCARD active_instances:<uid>                     # Count active

# CTF event scoreboard (per-event sorted set)
ZADD ctf:<event_id>:scoreboard <points> <team_id>
```

### 7.4 ClickHouse Tables (Analytics)

```sql
CREATE TABLE analytics.flag_submissions (
    timestamp       DateTime,
    user_id         UUID,
    machine_id      UUID,
    accepted        UInt8,
    response_time_ms UInt32,
    user_country    LowCardinality(String),
    user_tier       LowCardinality(String)
) ENGINE = MergeTree
ORDER BY (timestamp, machine_id);

CREATE TABLE analytics.lab_sessions (
    timestamp       DateTime,
    user_id         UUID,
    instance_id     UUID,
    machine_id      UUID,
    duration_sec    UInt32,
    backend         LowCardinality(String),
    region          LowCardinality(String),
    terminated_by   LowCardinality(String)  -- user|ttl|admin|failure
) ENGINE = MergeTree
ORDER BY (timestamp, user_id);

CREATE TABLE analytics.audit_log (
    timestamp       DateTime,
    actor_id        UUID,
    action          String,
    resource_type   String,
    resource_id     UUID,
    ip_address      String,
    metadata        String  -- JSON
) ENGINE = MergeTree
ORDER BY (timestamp, actor_id);
```

---

## 8. Security Architecture

### 8.1 Threat Model

**Threat actors:**
1. **Skilled users probing platform** (most likely): Will attempt container escapes, SSRF, IDOR, auth bypass
2. **Competitors**: DDoS, content scraping, account farming
3. **Cheaters**: Flag sharing, multi-account, automation
4. **External attackers**: Standard web/infra attacks

### 8.2 Defense in Depth

#### Layer 1: Edge
- Cloudflare WAF (managed rules + custom)
- DDoS protection (Cloudflare automatic)
- Rate limiting at edge (per IP)
- Bot detection (CF Turnstile for sensitive endpoints)
- Geo-blocking option for high-risk regions (configurable)

#### Layer 2: API Gateway
- JWT validation (RS256, short TTL)
- Per-user rate limiting (Redis-backed)
- Request size limits
- Schema validation (OpenAPI-based)
- mTLS for service-to-service

#### Layer 3: Application
- Input validation (Pydantic / Go validators)
- Output encoding (XSS prevention)
- Parameterized queries only (no raw SQL)
- CSRF tokens for state-changing operations
- Strict CORS policy
- CSP header strict mode
- Subresource integrity for CDN assets

#### Layer 4: Authentication
- Argon2id password hashing
- TOTP 2FA (required for admins, optional for users)
- Account lockout: 5 fails → 15 min lockout
- Suspicious login detection (geolocation, device)
- Session invalidation on password change

#### Layer 5: Authorization
- Role-based: user, premium, admin, content_creator, support
- Resource-based: users can only access own instances/data
- Audit log all admin actions

#### Layer 6: Lab Isolation (Most Critical)
- gVisor for container kernel isolation
- KVM for full VM isolation
- Network: per-user VLAN + namespace + iptables
- Egress filtering (lab → internet blocked)
- Resource limits (cgroups)
- No lab access to platform infra (firewall rules)
- Read-only root filesystems where possible

#### Layer 7: Data
- Encryption at rest: LUKS for disks, native PG encryption
- Encryption in transit: TLS 1.3 mandatory
- Secrets in HashiCorp Vault (not env vars or DB)
- Backup encryption (GPG)
- Database least-privilege: each service has its own DB user

#### Layer 8: Operations
- All access via bastion (SSH key + 2FA)
- Just-in-time access for production
- Tamper-evident audit logs (Loki + S3 immutable bucket)
- Runtime detection: Falco for anomalies
- Vulnerability scanning: Trivy on every image build
- Dependency scanning: Snyk / Dependabot

### 8.3 Anti-Cheat System

**Behavioral signals:**
- Solve time anomaly (statistical outlier)
- Identical solve paths across multiple accounts (IP-correlated)
- Flag submitted without sufficient instance interaction
- Multi-account farming (device fingerprint, IP, payment method)
- Writeup leak detection (compare submitted flags to leaked formats)

**Response:**
- Soft: shadow-flag for review, no immediate ban
- Medium: temporary suspension pending review
- Hard: account ban + IP block

### 8.4 Specific Platform-Targeted Mitigations

**Container escape:**
- gVisor reduces kernel attack surface
- AppArmor profiles for containers
- Drop all capabilities by default
- Read-only filesystems where possible
- No host volume mounts
- Seccomp profiles

**Network pivoting:**
- Default-deny egress
- Per-user network namespace
- iptables rules verified continuously
- Lab → platform infra blocked at multiple layers

**Resource exhaustion:**
- Hard limits per pod/VM (CPU, RAM, disk, network)
- Per-user concurrent instance quota
- Per-IP rate limits

**Account farming:**
- Email verification mandatory
- Phone verification for VIP tier (optional but pushed)
- Payment method fingerprinting
- Device fingerprinting (browser + OS signals)

### 8.5 Compliance Considerations

- **GDPR** (for EU users): right to deletion, data export, consent
- **PCI-DSS**: outsourced to Stripe (use Stripe Checkout, never touch card data)
- **Pakistan PECA**: data localization considerations
- **Terms of Service**: explicit "no scanning of platform infrastructure"
- **Responsible disclosure**: security@offensiveconditions.org with PGP key

---

## 9. Infrastructure & Deployment

### 9.1 Hybrid Strategy

**Cloud (AWS / DigitalOcean):**
- App services (low traffic, need elasticity)
- Managed PostgreSQL (RDS)
- Redis (ElastiCache)
- CloudFront / Cloudflare CDN
- SES for email

**Bare metal (Hetzner / OVH):**
- Lab compute (containers + VMs) — 80% of compute cost saved vs cloud
- VPN gateways (bandwidth-heavy)
- Object storage (MinIO) — large machine images
- Backups secondary location

**Rationale:**
- AWS egress is $0.09/GB → for VPN-heavy workload, kills budget
- Hetzner: ~€50/month for dedicated server (32 cores, 128GB RAM) vs AWS ~$1000+/month equivalent
- Hetzner bandwidth: 20TB included, then €1/TB vs AWS $90/TB

### 9.2 Region Strategy (Phase 1 → Phase 3)

**Phase 1 (Launch):**
- Primary: Hetzner Falkenstein (Germany) — low latency for EU + ME
- App services: AWS Frankfurt
- CDN: Cloudflare (global)

**Phase 2 (+6 months):**
- Add: Hetzner Helsinki (Finland) — capacity overflow
- Add: US lab region (Hetzner Ashburn or OVH BHS)

**Phase 3 (+12 months):**
- Add: Asia region (Singapore or India for South Asian users)
- Multi-region DB replication (read replicas)

### 9.3 Environment Layout

| Environment | Purpose | Scale |
|------------|---------|-------|
| dev | Active development | Single node, ephemeral |
| staging | Pre-production testing | 25% of prod capacity |
| prod | Live users | Full scale |
| sandbox | Security testing | Isolated, full reset weekly |

### 9.4 Kubernetes Topology

**Cluster 1: App Cluster** (services, APIs)
- 3 control plane nodes (HA)
- 5+ worker nodes (auto-scaled)
- Cloud-managed (EKS / DOKS)

**Cluster 2: Lab Cluster** (user labs)
- 3 control plane nodes
- 10-50 bare metal worker nodes
- gVisor runtime
- Calico CNI + Multus for multi-network

**Cluster 3: Data Cluster** (stateful)
- PostgreSQL operator (CloudNativePG)
- Redis operator
- Kafka (Strimzi)
- Dedicated SSD storage

### 9.5 Storage

| Type | Purpose | Tech |
|------|---------|------|
| Block (fast) | DB volumes, hot data | NVMe SSD, local |
| Block (general) | App volumes | Cloud block storage |
| Object | Images, media, backups | MinIO + S3 |
| Archive | Long-term backups, compliance | Backblaze B2 / S3 Glacier |

### 9.6 CI/CD Pipeline

```
Developer → Git push → GitHub Actions
                          │
                          ├─ Lint + format check
                          ├─ Unit tests
                          ├─ Integration tests
                          ├─ Security scan (Trivy, Snyk)
                          ├─ Build container → Harbor
                          ├─ Sign image (cosign)
                          └─ Deploy to staging (auto)
                                  │
                          Manual approval gate
                                  │
                          └─ Deploy to production (ArgoCD)
                                  │
                                  ├─ Canary 10% traffic (10 min)
                                  ├─ Auto rollback on metric breach
                                  └─ Full rollout
```

### 9.7 Disaster Recovery

| Metric | Target |
|--------|--------|
| RTO (Recovery Time Objective) | 4 hours |
| RPO (Recovery Point Objective) | 1 hour |

**Backup strategy:**
- DB: hourly snapshots + continuous WAL archival
- Object storage: cross-region replication
- Config: GitOps (everything in Git)
- Disaster runbook: quarterly drills

---

## 10. API Design

### 10.1 API Principles
- REST (JSON) for external (with GraphQL Phase 2)
- gRPC for internal service-to-service
- Versioning: URL-based (`/v1/`)
- Resource-oriented URLs
- Standard HTTP status codes
- Pagination: cursor-based for large lists
- Filtering: query params with consistent syntax

### 10.2 Standard Response Format

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-05-21T10:00:00Z"
  },
  "links": {
    "self": "/v1/machines?cursor=xyz",
    "next": "/v1/machines?cursor=abc"
  }
}
```

### 10.3 Error Format

```json
{
  "error": {
    "code": "INSTANCE_QUOTA_EXCEEDED",
    "message": "You have reached the maximum number of active instances",
    "details": {
      "current": 2,
      "limit": 2,
      "tier": "free"
    },
    "request_id": "req_abc123"
  }
}
```

### 10.4 Authentication

```
Authorization: Bearer <jwt_access_token>
```

JWT payload:
```json
{
  "sub": "<user_id>",
  "iss": "https://api.offensiveconditions.org",
  "aud": "offcon-api",
  "exp": 1747840000,
  "iat": 1747839100,
  "tier": "vip",
  "roles": ["user"],
  "session_id": "<sid>"
}
```

### 10.5 Rate Limits

| Endpoint Category | Anonymous | Free | VIP | VIP+ |
|------------------|-----------|------|-----|------|
| Auth (login/register) | 10/min | 10/min | 20/min | 20/min |
| Read (catalog, profile) | 60/min | 300/min | 600/min | 1200/min |
| Write (general) | — | 30/min | 60/min | 120/min |
| Flag submission | — | 5/min | 10/min | 20/min |
| Instance spawn | — | 2/hour | 10/hour | 30/hour |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1747840000
```

---

## 11. Monitoring & Observability

### 11.1 The Three Pillars

**Metrics (Prometheus):**
- Request rate, error rate, latency (RED)
- Resource usage (CPU, memory, disk, network)
- Business metrics (active instances, submissions/min, signups/hour)

**Logs (Loki):**
- Structured JSON logs
- Correlation via request_id
- Retention: 30 days hot, 1 year cold (S3)

**Traces (Tempo / Jaeger):**
- OpenTelemetry-instrumented services
- Sampling: 10% normal, 100% errors
- End-to-end request tracking across services

### 11.2 SLOs

| Service | SLO | Window |
|---------|-----|--------|
| API availability | 99.9% | 30 days |
| API p95 latency | < 200ms | 7 days |
| Lab spawn time (container) | < 30s p95 | 7 days |
| Lab spawn time (VM) | < 90s p95 | 7 days |
| Flag verification | < 100ms p99 | 7 days |
| VPN connection success | 99.5% | 7 days |

### 11.3 Alerting Tiers

| Tier | Response | Examples |
|------|----------|----------|
| P0 (page) | < 15 min | Site down, payments broken, security breach |
| P1 (urgent) | < 1 hour | Single service down, lab spawn failing >10% |
| P2 (normal) | Next business day | High latency, non-critical service degraded |
| P3 (info) | Weekly review | Capacity warnings, anomalies |

### 11.4 Security Monitoring

- Falco for runtime anomalies (container escapes, suspicious syscalls)
- OSSEC/Wazuh for host intrusion detection
- Suricata for network IDS
- VPN connection logs analyzed for anomalies
- Failed auth attempt patterns
- Egress traffic analysis from labs

---

## 12. Development Roadmap

### Phase 1: Foundation (Months 1-2)
**Goal:** Internal alpha — 5 machines, 10 internal users

- [x] Architecture finalized
- [ ] Cloud accounts + Hetzner contracts
- [ ] Kubernetes clusters (app + lab)
- [ ] CI/CD pipeline
- [ ] Auth service + User service
- [ ] Next.js scaffolding + landing page
- [ ] 5 test container machines
- [ ] Basic lab orchestrator (container only)
- [ ] WireGuard setup (manual configs)
- [ ] PostgreSQL + Redis deployed

### Phase 2: MVP (Months 3-4)
**Goal:** Closed beta — 500 invited users, 50 machines

- [ ] Lab orchestrator (K8s + Proxmox)
- [ ] VPN dynamic configuration
- [ ] Content service with full catalog
- [ ] Flag verification (anti-cheat v1)
- [ ] Scoring service + leaderboard
- [ ] Forum service
- [ ] Payment integration (Stripe)
- [ ] 50 machines (mix of container + VM)
- [ ] Admin dashboard
- [ ] **Closed beta launch**

### Phase 3: Public Launch (Months 5-7)
**Goal:** Public launch — open registration, 100+ machines

- [ ] Pwnbox (browser-based Kali via Apache Guacamole or similar)
- [ ] Learning paths (THM-style)
- [ ] Dojo challenges (pwn.college-style)
- [ ] Writeups service
- [ ] Advanced anti-cheat (ML-based)
- [ ] JazzCash/EasyPaisa for Pakistan
- [ ] Marketing site polish
- [ ] **Public launch**

### Phase 4: Pro Features (Months 8-10)
**Goal:** Enterprise readiness

- [ ] Pro Labs (multi-machine AD)
- [ ] CTF event engine
- [ ] Team accounts + enterprise tier
- [ ] Certifications (assessment + cert issuance)
- [ ] API for enterprise integrations
- [ ] Mobile app (React Native — optional)

### Phase 5: Bug Bounty (Months 11-12)
**Goal:** Marketplace launch

- [ ] Bounty service
- [ ] Company onboarding
- [ ] Triage workflow
- [ ] Payout system + escrow
- [ ] Legal framework
- [ ] **Bounty marketplace launch**

---

## Appendix A: Decision Log

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Architecture style | Microservices | Independent scaling, team velocity |
| Primary backend lang | Go | Performance + concurrency |
| Database | PostgreSQL | Reliability, JSON support, mature |
| Container runtime | gVisor | Security > performance for labs |
| VPN | WireGuard | Modern, fast, simple config |
| Service mesh | Istio | Mature, mTLS, observability |
| Frontend | Next.js | SSR, SEO, React ecosystem |
| Deployment | Hybrid (cloud + bare metal) | Cost-optimal for VPN-heavy workload |
| Hypervisor | Proxmox/KVM | Open source, mature, free |

## Appendix B: Open Questions

1. **Branding/Legal:** Trademark verification for "Offense Conditions"
2. **Payment processing:** Pakistan-based or US/UK entity? Affects Stripe availability
3. **Differentiator:** What is the unique value vs HTB? (pricing, region focus, content niche?)
4. **Content production:** In-house team or community contributions?
5. **Pricing model:** Match HTB ($14/mo) or undercut ($7/mo for South Asia)?

---

**Next Documents to Produce:**
1. `02-database-schema.sql` — Complete SQL schemas
2. `03-api-specifications.yaml` — OpenAPI specs per service
3. `04-deployment-guide.md` — Step-by-step infra setup
4. `05-coding-standards.md` — Team conventions
5. Repository structure + first service code
