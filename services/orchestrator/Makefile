# =============================================================================
# Lab Orchestrator — Makefile
# =============================================================================

.PHONY: help deps run run-server run-reaper run-operator test test-unit test-integration \
        build build-server build-reaper build-operator docker-build docker-push \
        k8s-apply k8s-delete fmt vet lint clean gen-mocks gen-crd

SHELL := /bin/bash

# Versioning
VERSION       ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_COMMIT    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LDFLAGS       := -s -w \
                 -X main.version=$(VERSION) \
                 -X main.buildTime=$(BUILD_TIME) \
                 -X main.gitCommit=$(GIT_COMMIT)

REGISTRY      ?= registry.offensiveconditions.org
IMAGE_SERVER  ?= $(REGISTRY)/orchestrator
IMAGE_REAPER  ?= $(REGISTRY)/orchestrator-reaper
IMAGE_OP      ?= $(REGISTRY)/orchestrator-operator

K8S_NAMESPACE ?= offcon-orchestrator
DEV_ENV_FILE  ?= .env

# =============================================================================
# Help
# =============================================================================
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# =============================================================================
# Dependencies
# =============================================================================
deps: ## Download Go module dependencies
	go mod download
	go mod tidy

# =============================================================================
# Run (development)
# =============================================================================
run: run-server ## Run server with env file

run-server: ## Run the HTTP+gRPC API server
	@test -f $(DEV_ENV_FILE) || (echo "Missing $(DEV_ENV_FILE) — copy .env.example" && exit 1)
	@set -a && . ./$(DEV_ENV_FILE) && set +a && go run ./cmd/server

run-reaper: ## Run the reaper standalone
	@test -f $(DEV_ENV_FILE) || (echo "Missing $(DEV_ENV_FILE)" && exit 1)
	@set -a && . ./$(DEV_ENV_FILE) && set +a && go run ./cmd/reaper

run-operator: ## Run the K8s operator
	@test -f $(DEV_ENV_FILE) || (echo "Missing $(DEV_ENV_FILE)" && exit 1)
	@set -a && . ./$(DEV_ENV_FILE) && set +a && go run ./cmd/operator

# =============================================================================
# Tests
# =============================================================================
test: test-unit ## Run unit tests

test-unit: ## Unit tests with race detector
	go test -race -count=1 -timeout=2m ./internal/... ./pkg/...

test-integration: ## Integration tests (requires Postgres available)
	INTEGRATION_TEST=1 go test -count=1 -timeout=5m ./tests/integration/...

test-coverage: ## Generate coverage report
	go test -race -coverprofile=coverage.out ./internal/...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: file://$(PWD)/coverage.html"

# =============================================================================
# Build
# =============================================================================
build: build-server build-reaper build-operator ## Build all binaries

build-server: ## Build server binary
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/server ./cmd/server

build-reaper: ## Build reaper binary
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/reaper ./cmd/reaper

build-operator: ## Build operator binary
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/operator ./cmd/operator

# =============================================================================
# Docker
# =============================================================================
docker-build: ## Build Docker images
	docker build --target server   -t $(IMAGE_SERVER):$(VERSION) -t $(IMAGE_SERVER):latest \
		--build-arg VERSION=$(VERSION) --build-arg GIT_COMMIT=$(GIT_COMMIT) --build-arg BUILD_TIME=$(BUILD_TIME) .
	docker build --target reaper   -t $(IMAGE_REAPER):$(VERSION) -t $(IMAGE_REAPER):latest .
	docker build --target operator -t $(IMAGE_OP):$(VERSION)     -t $(IMAGE_OP):latest .

docker-push: ## Push images to registry
	docker push $(IMAGE_SERVER):$(VERSION) && docker push $(IMAGE_SERVER):latest
	docker push $(IMAGE_REAPER):$(VERSION) && docker push $(IMAGE_REAPER):latest
	docker push $(IMAGE_OP):$(VERSION)     && docker push $(IMAGE_OP):latest

# =============================================================================
# Kubernetes
# =============================================================================
k8s-apply: ## Apply CRD + deployment manifests
	kubectl apply -f crd/labinstance_v1.yaml
	kubectl apply -f deployments/kubernetes.yaml

k8s-delete: ## Delete deployment (preserves CRD)
	kubectl delete -f deployments/kubernetes.yaml --ignore-not-found

k8s-logs-server: ## Tail server logs
	kubectl -n $(K8S_NAMESPACE) logs -l app.kubernetes.io/component=api -f --tail=100

k8s-logs-reaper: ## Tail reaper logs
	kubectl -n $(K8S_NAMESPACE) logs -l app.kubernetes.io/component=reaper -f --tail=100

# =============================================================================
# Code quality
# =============================================================================
fmt: ## Format code
	gofmt -s -w .
	go mod tidy

vet: ## Run go vet
	go vet ./...

lint: ## Run golangci-lint (install: https://golangci-lint.run/usage/install/)
	golangci-lint run --timeout=3m ./...

check: fmt vet lint test-unit ## Run all code-quality checks

# =============================================================================
# Cleanup
# =============================================================================
clean: ## Remove build artifacts
	rm -rf bin/ coverage.out coverage.html

# =============================================================================
# Generated code
# =============================================================================
gen-crd: ## Generate CRD types (requires controller-gen)
	@which controller-gen >/dev/null || (echo "Install controller-gen: go install sigs.k8s.io/controller-tools/cmd/controller-gen@latest" && exit 1)
	controller-gen object paths="./internal/operator/..." output:dir=internal/operator
	controller-gen crd paths="./internal/operator/..." output:crd:dir=crd

gen-mocks: ## Generate mocks (requires mockgen)
	@which mockgen >/dev/null || (echo "Install mockgen: go install go.uber.org/mock/mockgen@latest" && exit 1)
	mockgen -source=internal/repository/interfaces.go -destination=internal/repository/mocks/repository.go
	mockgen -source=internal/backends/backend.go -destination=internal/backends/mocks/backend.go
