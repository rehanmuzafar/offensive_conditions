# OFFCON — CI/CD & GitOps (Phase 16)

The delivery pipeline for the whole platform: **build → test → scan → ship →
deploy**, fully automated. CI proves correctness, GitHub Actions builds + signs
artifacts and bumps desired state in git, and **ArgoCD** reconciles the cluster
to match.

```
  git push ──► GitHub Actions ──────────────────────────────────► GHCR
   (PR)          │  CI: lint + test (Go/Py/Node/frontend/helm)     (signed,
   (main)        │  Security: CodeQL + Trivy + Gitleaks             multi-arch
   (tag)         │  Release: build → scan → sign → push             images)
                 │                                                      │
                 └─► bump image tags in helm/values/*.yaml ◄───────────┘
                                    │ (git commit)
                                    ▼
                              ArgoCD (GitOps)
                                    │  watches git, reconciles cluster
                     ┌──────────────┼───────────────┐
                     ▼              ▼               ▼
              offcon-staging   offcon-production  observability + gateway
```

## Layout

```
cicd/
├── helm/
│   ├── offcon-service/      Reusable chart — ONE template for every service
│   │   └── templates/       Deployment, Service, HPA, PDB, SA, DestinationRule
│   ├── offcon/              Umbrella chart — 12 services + frontend as subcharts
│   │   ├── Chart.yaml        (each aliased to offcon-service)
│   │   ├── values.yaml       per-service production config
│   │   └── templates/        shared ConfigMap (service discovery, OTLP, ...)
│   └── values/
│       ├── staging.yaml      env override (small footprint)
│       └── production.yaml   env override (full scale + tight PDBs)
├── github/
│   ├── workflows/
│   │   ├── ci.yml            lint + test, path-filtered, single gate check
│   │   ├── security.yml      CodeQL + Trivy (fs/config/image) + Gitleaks
│   │   └── release.yml       build → scan → sign → push → bump GitOps tags
│   └── actions/build-push/   composite: multi-arch build, cache, SBOM, provenance
├── argocd/
│   ├── projects/             AppProject (scoped repos/namespaces/resources)
│   ├── applicationsets/      one App per env from a single template
│   └── applications/         standalone apps: gateway, observability
└── scripts/bootstrap.sh      one-time cluster bootstrap
```

## The one-chart pattern

Every microservice is deployed by the **same** `offcon-service` chart — there is
exactly one Deployment/Service/HPA/PDB/DestinationRule template in the repo. A
service is just a values block in `helm/offcon/values.yaml`. Add a service →
add a dependency alias + a values block. No copy-pasted manifests, no drift.

```bash
# Render everything locally
helm dependency build helm/offcon
helm template offcon helm/offcon -f helm/values/production.yaml
```

## CI (`ci.yml`)

- **Path filters** — only the services that changed get tested (fast monorepo CI).
- **Go**: `go vet`, `golangci-lint`, `go test -race`, `go build`.
- **Python**: `ruff` (lint+format), `mypy`, `pytest --cov`.
- **Node + frontend**: `eslint`, `tsc --noEmit`, tests, `next build`.
- **Helm**: `helm lint` + `helm template` for both envs.
- **`ci-success`** — a single required status check for branch protection.

## Release (`release.yml`)

On push to `main` (or a `vX.Y.Z` tag):
1. Determine changed services (tag → build all).
2. Multi-arch build + push to GHCR with GHA layer cache, **SBOM + provenance**.
3. **Trivy** scans the pushed image; results → Security tab.
4. **cosign** keyless-signs the image.
5. **Bump image tags** in `helm/values/{staging|production}.yaml` and commit
   `[skip ci]`. ArgoCD takes it from there.

`main` → staging tags. `vX.Y.Z` tag → production tags.

## GitOps (ArgoCD)

- **AppProject** scopes allowed source repos, destination namespaces, and
  resource kinds; includes a weekend production sync-freeze window.
- **ApplicationSet** generates `offcon-staging` + `offcon-production` from one
  template — both auto-sync with prune + self-heal.
- Standalone **Applications** deploy the Phase 14 gateway and Phase 15
  observability stack.

```bash
# One-time, after ArgoCD + Istio are installed and secrets exist:
./scripts/bootstrap.sh
```

## Image signing & provenance

Every image is multi-arch, ships an **SBOM**, carries **build provenance**, and
is **cosign-signed** (keyless via GitHub OIDC). Verify:

```bash
cosign verify ghcr.io/offcon/auth-svc@<digest> \
  --certificate-identity-regexp 'https://github.com/offcon/offcon/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
