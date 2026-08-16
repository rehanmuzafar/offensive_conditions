# Offensive Conditions — Repository Structure

> Monorepo layout for the entire platform. Designed for clear ownership, independent service deployment, and shared tooling.

```
offensive-conditions/
│
├── README.md
├── ARCHITECTURE.md                    # System architecture (this repo's master doc)
├── CONTRIBUTING.md
├── SECURITY.md                        # Responsible disclosure policy
├── LICENSE
├── .editorconfig
├── .gitignore
│
├── docs/                              # All documentation
│   ├── architecture/
│   │   ├── 01-overview.md
│   │   ├── 02-services.md
│   │   ├── 03-data-model.md
│   │   ├── 04-network.md
│   │   ├── 05-security.md
│   │   └── 06-orchestrator.md
│   ├── api/
│   │   ├── auth.openapi.yaml
│   │   ├── user.openapi.yaml
│   │   ├── content.openapi.yaml
│   │   ├── orchestrator.openapi.yaml
│   │   ├── scoring.openapi.yaml
│   │   └── ... (per service)
│   ├── runbooks/                      # Operational runbooks
│   │   ├── incident-response.md
│   │   ├── lab-cluster-recovery.md
│   │   ├── vpn-troubleshooting.md
│   │   └── database-failover.md
│   ├── adr/                           # Architecture Decision Records
│   │   ├── 001-microservices.md
│   │   ├── 002-go-as-primary.md
│   │   ├── 003-gvisor-isolation.md
│   │   └── ...
│   └── onboarding/
│       └── dev-setup.md
│
├── services/                          # All microservices
│   │
│   ├── auth/                          # Go service — authentication
│   │   ├── cmd/server/main.go
│   │   ├── internal/
│   │   │   ├── handlers/
│   │   │   ├── middleware/
│   │   │   ├── repository/
│   │   │   ├── service/
│   │   │   ├── crypto/
│   │   │   └── config/
│   │   ├── pkg/                       # Public packages (shared client libs)
│   │   ├── migrations/                # SQL migrations
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   ├── go.mod
│   │   └── README.md
│   │
│   ├── user/                          # Go service — user profiles
│   │   └── ... (same structure)
│   │
│   ├── content/                       # Python FastAPI — catalog
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── api/
│   │   │   ├── core/
│   │   │   ├── models/
│   │   │   ├── repositories/
│   │   │   └── services/
│   │   ├── migrations/                # Alembic
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   └── README.md
│   │
│   ├── orchestrator/                  # Go service — CORE: lab management
│   │   ├── cmd/
│   │   │   ├── server/main.go         # API server
│   │   │   ├── reaper/main.go         # TTL cleanup worker
│   │   │   └── operator/main.go       # K8s operator
│   │   ├── internal/
│   │   │   ├── api/
│   │   │   ├── scheduler/
│   │   │   ├── backends/
│   │   │   │   ├── kubernetes/
│   │   │   │   └── proxmox/
│   │   │   ├── network/               # VLAN, firewall, VPN
│   │   │   ├── flag/
│   │   │   └── lifecycle/
│   │   ├── crd/                       # Custom Resource Definitions
│   │   │   └── labinstance_v1.yaml
│   │   ├── Dockerfile
│   │   └── README.md
│   │
│   ├── flag-verifier/                 # Go service — flag validation
│   ├── scoring/                       # Go service — points/leaderboard
│   ├── ctf-engine/                    # Python — CTF events
│   ├── payment/                       # Node.js — billing
│   ├── forum/                         # Python — discussions
│   ├── writeup/                       # Python — solutions
│   ├── notification/                  # Node.js — real-time + email
│   └── bounty/                        # Python — bug bounty (Phase 5)
│
├── apps/                              # User-facing applications
│   │
│   ├── web/                           # Main Next.js web app
│   │   ├── app/                       # App router pages
│   │   │   ├── (auth)/
│   │   │   ├── (dashboard)/
│   │   │   ├── machines/
│   │   │   ├── challenges/
│   │   │   ├── paths/
│   │   │   ├── ctf/
│   │   │   ├── leaderboard/
│   │   │   ├── forum/
│   │   │   └── profile/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── hooks/
│   │   ├── public/
│   │   ├── styles/
│   │   ├── package.json
│   │   └── next.config.js
│   │
│   ├── admin/                         # Admin dashboard (separate Next.js)
│   │   └── ... (same structure)
│   │
│   └── pwnbox/                        # Browser Kali (Apache Guacamole config)
│       ├── docker/
│       └── README.md
│
├── packages/                          # Shared libraries
│   ├── proto/                         # gRPC proto definitions
│   │   ├── auth/v1/
│   │   ├── orchestrator/v1/
│   │   └── ...
│   ├── ui/                            # Shared React components
│   ├── eslint-config/
│   ├── typescript-config/
│   ├── go-common/                     # Shared Go utilities
│   │   ├── logger/
│   │   ├── tracing/
│   │   ├── auth/
│   │   ├── db/
│   │   └── errors/
│   └── py-common/                     # Shared Python utilities
│       └── offcon_common/
│
├── infrastructure/                    # All IaC — Terraform + Ansible + K8s
│   ├── terraform/
│   │   ├── modules/
│   │   │   ├── k8s-cluster/
│   │   │   ├── vpn-server/
│   │   │   ├── database/
│   │   │   └── network/
│   │   ├── environments/
│   │   │   ├── dev/
│   │   │   ├── staging/
│   │   │   └── prod/
│   │   └── README.md
│   │
│   ├── ansible/
│   │   ├── playbooks/
│   │   │   ├── proxmox-node-setup.yml
│   │   │   ├── vpn-gateway-setup.yml
│   │   │   └── bastion-setup.yml
│   │   ├── roles/
│   │   └── inventory/
│   │
│   ├── kubernetes/
│   │   ├── base/                      # Base manifests
│   │   │   ├── auth/
│   │   │   ├── orchestrator/
│   │   │   └── ...
│   │   ├── overlays/                  # Kustomize overlays
│   │   │   ├── dev/
│   │   │   ├── staging/
│   │   │   └── prod/
│   │   ├── istio/                     # Service mesh configs
│   │   ├── monitoring/                # Prometheus, Grafana, Loki
│   │   ├── operators/                 # K8s operators
│   │   └── network-policies/
│   │
│   └── docker/                        # Shared Docker base images
│       ├── go-builder/
│       ├── python-builder/
│       └── node-builder/
│
├── lab-content/                       # CTF challenge + machine source
│   ├── machines/
│   │   ├── linux/
│   │   │   ├── blue/
│   │   │   │   ├── Dockerfile
│   │   │   │   ├── setup.sh
│   │   │   │   ├── flag.template
│   │   │   │   ├── walkthrough.md     # Internal only
│   │   │   │   └── metadata.yaml
│   │   │   └── ...
│   │   └── windows/
│   │       └── ... (VM templates + cloud-init)
│   ├── challenges/
│   │   ├── web/
│   │   ├── pwn/
│   │   ├── crypto/
│   │   ├── reverse/
│   │   └── forensics/
│   ├── dojos/                         # pwn.college-style modules
│   │   ├── linux-basics/
│   │   ├── intro-to-pwn/
│   │   └── web-fundamentals/
│   └── pro-labs/                      # Multi-machine AD environments
│       ├── corporate-network/
│       └── enterprise-domain/
│
├── tools/                             # Internal developer tooling
│   ├── content-validator/             # Validates challenge metadata
│   ├── flag-generator/                # CLI for generating flag templates
│   ├── lab-tester/                    # Automated machine validation
│   └── dev-env/                       # Local dev environment setup
│       ├── docker-compose.yml
│       └── seed-data/
│
├── scripts/                           # One-off scripts
│   ├── deploy/
│   ├── migrations/
│   └── operational/
│
├── .github/                           # GitHub Actions workflows
│   ├── workflows/
│   │   ├── ci-go.yml
│   │   ├── ci-python.yml
│   │   ├── ci-node.yml
│   │   ├── security-scan.yml
│   │   ├── deploy-staging.yml
│   │   └── deploy-prod.yml
│   ├── CODEOWNERS
│   └── PULL_REQUEST_TEMPLATE.md
│
├── tests/                             # Cross-service E2E tests
│   ├── e2e/
│   ├── load/                          # k6 load tests
│   └── security/                      # OWASP ZAP, custom security tests
│
├── Makefile                           # Common commands
├── go.work                            # Go workspace
├── pnpm-workspace.yaml                # JS workspace
└── turbo.json                         # Turborepo config (build acceleration)
```

## Repository Conventions

### Branch Strategy
- `main` — production-ready, protected
- `develop` — integration branch (optional, can use trunk-based)
- `feature/<ticket>-<short-desc>` — feature branches
- `hotfix/<ticket>-<short-desc>` — production hotfixes
- `release/v<version>` — release prep

### Commit Convention (Conventional Commits)
```
feat(auth): add TOTP 2FA support
fix(orchestrator): handle pod stuck in Pending state
docs(api): update orchestrator spawn endpoint
refactor(scoring): extract leaderboard calculation
test(content): add machine catalog integration tests
chore(deps): bump go to 1.22
```

### Versioning
- Services: SemVer (`v1.2.3`)
- API: URL-versioned (`/v1/`, `/v2/`)
- Database migrations: timestamped (`20260521120000_add_users.sql`)

### Code Ownership (CODEOWNERS)
```
/services/orchestrator/    @backend-team @platform-team
/services/auth/            @backend-team @security-team
/apps/web/                 @frontend-team
/infrastructure/           @platform-team
/lab-content/              @content-team
```

### Per-Service README Template
Every service must have:
- Purpose (one paragraph)
- Local dev setup (one command if possible)
- Environment variables
- API endpoints (link to OpenAPI spec)
- Dependencies (other services, infra)
- Runbook link
- Owner team

## Development Workflow

```bash
# Initial setup (once)
make setup                  # Install all deps across languages

# Local dev (entire stack)
make dev                    # docker-compose up with all services

# Run specific service
cd services/auth
make run                    # Hot reload + DB ready

# Tests
make test                   # All services + apps
make test-service SERVICE=auth
make test-e2e               # E2E across stack

# Build all
make build

# Deploy (CI handles this, but manual override exists)
make deploy ENV=staging
```
