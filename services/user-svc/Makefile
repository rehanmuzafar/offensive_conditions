# =============================================================================
# user-svc Makefile
# =============================================================================

GO          ?= go
DOCKER      ?= docker
KUBECTL     ?= kubectl
REGISTRY    ?= registry.offensiveconditions.org
IMAGE_NAME  ?= user-svc
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT      ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
NAMESPACE   ?= offcon
LDFLAGS     := -ldflags="-s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT)"

.DEFAULT_GOAL := help

# =============================================================================
# Help
# =============================================================================
.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# =============================================================================
# Build
# =============================================================================
.PHONY: build
build: build-server build-worker build-gdprjob ## Build all binaries

.PHONY: build-server
build-server: ## Build the HTTP+gRPC server
	@mkdir -p bin
	CGO_ENABLED=0 $(GO) build -trimpath $(LDFLAGS) -o bin/server ./cmd/server

.PHONY: build-worker
build-worker: ## Build the Kafka consumer worker
	@mkdir -p bin
	CGO_ENABLED=0 $(GO) build -trimpath $(LDFLAGS) -o bin/worker ./cmd/worker

.PHONY: build-gdprjob
build-gdprjob: ## Build the GDPR cron job
	@mkdir -p bin
	CGO_ENABLED=0 $(GO) build -trimpath $(LDFLAGS) -o bin/gdprjob ./cmd/gdprjob

# =============================================================================
# Run (local dev)
# =============================================================================
.PHONY: run-server run-worker run-gdprjob
run-server: build-server ## Run the server locally
	./bin/server
run-worker: build-worker ## Run the worker locally
	./bin/worker
run-gdprjob: build-gdprjob ## Run the gdprjob locally
	./bin/gdprjob

# =============================================================================
# Test + lint
# =============================================================================
.PHONY: test
test: ## Run all tests
	$(GO) test -race -timeout 5m ./...

.PHONY: test-cover
test-cover: ## Test with coverage
	$(GO) test -race -coverprofile=coverage.out -covermode=atomic ./...
	$(GO) tool cover -func=coverage.out

.PHONY: test-integration
test-integration: ## Run integration tests (requires postgres + redis + minio)
	$(GO) test -race -timeout 10m -tags=integration ./tests/integration/...

.PHONY: lint
lint: ## Run golangci-lint
	@command -v golangci-lint >/dev/null 2>&1 || { echo "install golangci-lint first"; exit 1; }
	golangci-lint run ./...

.PHONY: vet
vet: ## Run go vet
	$(GO) vet ./...

.PHONY: fmt
fmt: ## Run gofmt
	$(GO) fmt ./...

.PHONY: tidy
tidy: ## Run go mod tidy
	$(GO) mod tidy

# =============================================================================
# Docker
# =============================================================================
.PHONY: docker
docker: docker-server docker-worker docker-gdprjob ## Build all docker images

.PHONY: docker-server
docker-server: ## Build server image
	$(DOCKER) build \
		--build-arg BINARY=server \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		-t $(REGISTRY)/$(IMAGE_NAME):$(VERSION) \
		-t $(REGISTRY)/$(IMAGE_NAME):latest \
		.

.PHONY: docker-worker
docker-worker: ## Build worker image
	$(DOCKER) build \
		--build-arg BINARY=worker \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		-t $(REGISTRY)/$(IMAGE_NAME)-worker:$(VERSION) \
		-t $(REGISTRY)/$(IMAGE_NAME)-worker:latest \
		.

.PHONY: docker-gdprjob
docker-gdprjob: ## Build gdprjob image
	$(DOCKER) build \
		--build-arg BINARY=gdprjob \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		-t $(REGISTRY)/$(IMAGE_NAME)-gdprjob:$(VERSION) \
		-t $(REGISTRY)/$(IMAGE_NAME)-gdprjob:latest \
		.

.PHONY: docker-push
docker-push: docker ## Push all images
	$(DOCKER) push $(REGISTRY)/$(IMAGE_NAME):$(VERSION)
	$(DOCKER) push $(REGISTRY)/$(IMAGE_NAME)-worker:$(VERSION)
	$(DOCKER) push $(REGISTRY)/$(IMAGE_NAME)-gdprjob:$(VERSION)

# =============================================================================
# Kubernetes
# =============================================================================
.PHONY: k8s-apply k8s-delete k8s-status k8s-logs
k8s-apply: ## Apply manifests
	$(KUBECTL) apply -f deployments/kubernetes.yaml -n $(NAMESPACE)
k8s-delete: ## Delete manifests
	$(KUBECTL) delete -f deployments/kubernetes.yaml -n $(NAMESPACE)
k8s-status: ## Show deployment status
	$(KUBECTL) get all -l app=user-svc -n $(NAMESPACE)
k8s-logs: ## Tail server logs
	$(KUBECTL) logs -f -l app=user-svc,role=server -n $(NAMESPACE) --max-log-requests=10

# =============================================================================
# Migrations (assumes migrate CLI present)
# =============================================================================
.PHONY: migrate-up migrate-down
migrate-up: ## Apply user-svc migrations
	@command -v migrate >/dev/null || { echo "install golang-migrate first"; exit 1; }
	migrate -path migrations -database "$$DATABASE_URL" up
migrate-down: ## Rollback last user-svc migration
	@command -v migrate >/dev/null || { echo "install golang-migrate first"; exit 1; }
	migrate -path migrations -database "$$DATABASE_URL" down 1

# =============================================================================
# OpenAPI
# =============================================================================
.PHONY: openapi-validate
openapi-validate: ## Validate OpenAPI spec
	@command -v swagger-cli >/dev/null || npx --yes @apidevtools/swagger-cli validate api/openapi/openapi.yaml || \
		swagger-cli validate api/openapi/openapi.yaml

# =============================================================================
# Cleanup
# =============================================================================
.PHONY: clean
clean: ## Remove build artifacts
	rm -rf bin/ coverage.out
