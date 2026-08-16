# =============================================================================
# Offensive Conditions Auth Service
# =============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT     ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS    := -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildDate=$(BUILD_DATE)

BIN_NAME   := auth
BIN_PATH   := ./bin/$(BIN_NAME)
DOCKER_TAG := offcon/auth:$(VERSION)

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-18s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## Install dev dependencies (Go tools)
	@echo "$(GREEN)Installing dev tools...$(NC)"
	go install github.com/cosmtrek/air@latest
	go install honnef.co/go/tools/cmd/staticcheck@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

.PHONY: deps
deps: ## Download Go module dependencies
	go mod download
	go mod tidy

.PHONY: gen-keys
gen-keys: ## Generate dev JWT RSA keypair
	@bash scripts/gen-jwt-keys.sh

.PHONY: build
build: ## Build the binary
	@echo "$(GREEN)Building $(BIN_NAME) $(VERSION)...$(NC)"
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_PATH) ./cmd/server
	@echo "$(GREEN)→ $(BIN_PATH)$(NC)"

.PHONY: run
run: ## Run the service (loads .env)
	@if [ ! -f .env ]; then echo "$(YELLOW)WARNING: .env not found. Copy .env.example.$(NC)"; fi
	set -a && source .env 2>/dev/null; set +a; \
	go run ./cmd/server

.PHONY: dev
dev: ## Run with hot reload (requires air)
	@if ! command -v air &> /dev/null; then echo "Install: make setup"; exit 1; fi
	air

.PHONY: test
test: ## Run unit tests
	@echo "$(GREEN)Running unit tests...$(NC)"
	go test -race -coverprofile=coverage.out -covermode=atomic ./internal/... ./tests/unit/...

.PHONY: test-integration
test-integration: ## Run integration tests (requires Postgres + Redis)
	@echo "$(GREEN)Running integration tests...$(NC)"
	go test -tags=integration -count=1 ./tests/integration/...

.PHONY: test-coverage
test-coverage: test ## Generate HTML coverage report
	go tool cover -html=coverage.out -o coverage.html
	@echo "$(GREEN)→ coverage.html$(NC)"

.PHONY: lint
lint: ## Run linters
	@echo "$(GREEN)Running golangci-lint...$(NC)"
	golangci-lint run --timeout=5m ./...

.PHONY: vet
vet: ## Run go vet
	go vet ./...

.PHONY: fmt
fmt: ## Format code
	gofmt -s -w .

.PHONY: check
check: fmt vet lint test ## Run all checks (CI gate)

.PHONY: docker
docker: ## Build Docker image
	@echo "$(GREEN)Building $(DOCKER_TAG)...$(NC)"
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		-t $(DOCKER_TAG) \
		-t offcon/auth:latest \
		.

.PHONY: docker-push
docker-push: docker ## Push Docker image to registry
	docker push $(DOCKER_TAG)
	docker push offcon/auth:latest

.PHONY: k8s-apply
k8s-apply: ## Apply Kubernetes manifests
	kubectl apply -f deployments/kubernetes.yaml

.PHONY: k8s-diff
k8s-diff: ## Show what would change in K8s
	kubectl diff -f deployments/kubernetes.yaml || true

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf bin/ coverage.out coverage.html

.PHONY: secrets-gen
secrets-gen: ## Generate random secrets for .env
	@echo "TFA_ENCRYPTION_KEY=$$(openssl rand -hex 32)"
	@echo "OAUTH_STATE_SECRET=$$(openssl rand -hex 32)"
	@echo "DB_PASSWORD=$$(openssl rand -base64 24)"
