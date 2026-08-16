# =============================================================================
# Scoring Service — Makefile
# =============================================================================

SHELL := /bin/bash
SVC := scoring
VERSION ?= 0.1.0
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
REGISTRY ?= ghcr.io/offcon

GO ?= go
GOFLAGS := -trimpath
LDFLAGS := -s -w \
  -X github.com/offensive-conditions/scoring/internal/buildinfo.Version=$(VERSION) \
  -X github.com/offensive-conditions/scoring/internal/buildinfo.Commit=$(COMMIT) \
  -X github.com/offensive-conditions/scoring/internal/buildinfo.BuildDate=$(BUILD_DATE)

OUT := bin
BINARIES := scoring-server scoring-worker scoring-seasonjob

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  build              build all binaries"
	@echo "  build-server       build server only"
	@echo "  build-worker       build worker only"
	@echo "  build-seasonjob    build seasonjob only"
	@echo "  test               run unit tests"
	@echo "  test-integration   run integration tests (needs DB+Redis+Kafka)"
	@echo "  bench              run benchmarks"
	@echo "  lint               run static analysis"
	@echo "  fmt                go fmt"
	@echo "  vet                go vet"
	@echo "  tidy               go mod tidy"
	@echo "  run-server         run the API server locally"
	@echo "  run-worker         run the Kafka worker locally"
	@echo "  run-seasonjob      run the cron seasonjob locally"
	@echo "  docker             build all docker images"
	@echo "  docker-server      build the server image"
	@echo "  docker-worker      build the worker image"
	@echo "  docker-seasonjob   build the seasonjob image"
	@echo "  docker-push        push all images to registry"
	@echo "  k8s-apply          kubectl apply manifests"
	@echo "  k8s-delete         kubectl delete manifests"
	@echo "  migrate-up         apply database migrations"
	@echo "  migrate-down       revert last migration"
	@echo "  openapi-validate   validate OpenAPI spec"
	@echo "  clean              clean build artifacts"

# =============================================================================
# Build
# =============================================================================

.PHONY: build
build: build-server build-worker build-seasonjob

.PHONY: build-server
build-server:
	@mkdir -p $(OUT)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(OUT)/scoring-server ./cmd/server

.PHONY: build-worker
build-worker:
	@mkdir -p $(OUT)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(OUT)/scoring-worker ./cmd/worker

.PHONY: build-seasonjob
build-seasonjob:
	@mkdir -p $(OUT)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(OUT)/scoring-seasonjob ./cmd/seasonjob

# =============================================================================
# Test & quality
# =============================================================================

.PHONY: test
test:
	$(GO) test -race -timeout 120s -coverprofile=coverage.out ./internal/...

.PHONY: test-integration
test-integration:
	$(GO) test -race -timeout 5m -tags=integration ./tests/integration/...

.PHONY: bench
bench:
	$(GO) test -bench=. -benchmem -run=^$$ ./internal/points/... ./internal/elo/...

.PHONY: lint
lint:
	@command -v golangci-lint >/dev/null || (echo "install golangci-lint"; exit 1)
	golangci-lint run ./...

.PHONY: fmt
fmt:
	$(GO) fmt ./...

.PHONY: vet
vet:
	$(GO) vet ./...

.PHONY: tidy
tidy:
	$(GO) mod tidy

# =============================================================================
# Run locally
# =============================================================================

.PHONY: run-server
run-server:
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && \
	$(GO) run ./cmd/server

.PHONY: run-worker
run-worker:
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && \
	$(GO) run ./cmd/worker

.PHONY: run-seasonjob
run-seasonjob:
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && \
	$(GO) run ./cmd/seasonjob

# =============================================================================
# Docker
# =============================================================================

.PHONY: docker
docker: docker-server docker-worker docker-seasonjob

.PHONY: docker-server
docker-server:
	docker build --target server \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  --build-arg BUILD_DATE=$(BUILD_DATE) \
	  -t $(REGISTRY)/scoring-server:$(VERSION) \
	  -t $(REGISTRY)/scoring-server:latest .

.PHONY: docker-worker
docker-worker:
	docker build --target worker \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  --build-arg BUILD_DATE=$(BUILD_DATE) \
	  -t $(REGISTRY)/scoring-worker:$(VERSION) \
	  -t $(REGISTRY)/scoring-worker:latest .

.PHONY: docker-seasonjob
docker-seasonjob:
	docker build --target seasonjob \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  --build-arg BUILD_DATE=$(BUILD_DATE) \
	  -t $(REGISTRY)/scoring-seasonjob:$(VERSION) \
	  -t $(REGISTRY)/scoring-seasonjob:latest .

.PHONY: docker-push
docker-push:
	docker push $(REGISTRY)/scoring-server:$(VERSION)
	docker push $(REGISTRY)/scoring-server:latest
	docker push $(REGISTRY)/scoring-worker:$(VERSION)
	docker push $(REGISTRY)/scoring-worker:latest
	docker push $(REGISTRY)/scoring-seasonjob:$(VERSION)
	docker push $(REGISTRY)/scoring-seasonjob:latest

# =============================================================================
# Kubernetes
# =============================================================================

.PHONY: k8s-apply
k8s-apply:
	kubectl apply -f deployments/kubernetes.yaml

.PHONY: k8s-delete
k8s-delete:
	kubectl delete -f deployments/kubernetes.yaml --ignore-not-found

.PHONY: k8s-logs-server
k8s-logs-server:
	kubectl -n offcon logs -l app=scoring,component=server --tail=200 -f

.PHONY: k8s-logs-worker
k8s-logs-worker:
	kubectl -n offcon logs -l app=scoring,component=worker --tail=200 -f

# =============================================================================
# Migrations
# =============================================================================

MIGRATE ?= migrate
DB_URL := postgres://$${DB_USER}:$${DB_PASSWORD}@$${DB_HOST}:$${DB_PORT}/$${DB_NAME}?sslmode=$${DB_SSLMODE}

.PHONY: migrate-up
migrate-up:
	$(MIGRATE) -path migrations -database "$(DB_URL)" up

.PHONY: migrate-down
migrate-down:
	$(MIGRATE) -path migrations -database "$(DB_URL)" down 1

# =============================================================================
# OpenAPI
# =============================================================================

.PHONY: openapi-validate
openapi-validate:
	@command -v openapi-cli >/dev/null || (echo "install @redocly/cli"; exit 1)
	openapi-cli lint api/openapi.yaml

# =============================================================================
# Cleanup
# =============================================================================

.PHONY: clean
clean:
	rm -rf $(OUT) coverage.out
