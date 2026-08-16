SHELL := /bin/bash
SVC := flag-verifier
VERSION ?= 0.1.0
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
REGISTRY ?= ghcr.io/offcon

GO ?= go
GOFLAGS := -trimpath
LDFLAGS := -s -w \
  -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.Version=$(VERSION) \
  -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.Commit=$(COMMIT) \
  -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.BuildDate=$(BUILD_DATE)

OUT := bin

.PHONY: help
help:
	@echo "Targets:"
	@echo "  build              build the server binary"
	@echo "  test               run unit tests"
	@echo "  test-integration   run integration tests (needs TEST_DB_DSN + TEST_REDIS_ADDR)"
	@echo "  bench              run benchmarks"
	@echo "  lint               golangci-lint"
	@echo "  fmt                gofmt"
	@echo "  vet                go vet"
	@echo "  tidy               go mod tidy"
	@echo "  run                run locally (uses .env if present)"
	@echo "  docker             build docker image"
	@echo "  docker-push        push to registry"
	@echo "  k8s-apply          kubectl apply manifests"
	@echo "  k8s-delete         kubectl delete manifests"
	@echo "  openapi-validate   validate OpenAPI spec"
	@echo "  clean              remove build artifacts"

.PHONY: build
build:
	@mkdir -p $(OUT)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(OUT)/flag-verifier ./cmd/server

.PHONY: test
test:
	$(GO) test -race -timeout 60s -coverprofile=coverage.out ./internal/...

.PHONY: test-integration
test-integration:
	$(GO) test -race -timeout 5m -tags=integration ./tests/integration/...

.PHONY: bench
bench:
	$(GO) test -bench=. -benchmem -run=^$$ ./internal/hmac/... ./internal/ratelimit/...

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

.PHONY: run
run:
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && \
	$(GO) run ./cmd/server

.PHONY: docker
docker:
	docker build \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  --build-arg BUILD_DATE=$(BUILD_DATE) \
	  -t $(REGISTRY)/flag-verifier:$(VERSION) \
	  -t $(REGISTRY)/flag-verifier:latest .

.PHONY: docker-push
docker-push:
	docker push $(REGISTRY)/flag-verifier:$(VERSION)
	docker push $(REGISTRY)/flag-verifier:latest

.PHONY: k8s-apply
k8s-apply:
	kubectl apply -f deployments/kubernetes.yaml

.PHONY: k8s-delete
k8s-delete:
	kubectl delete -f deployments/kubernetes.yaml --ignore-not-found

.PHONY: k8s-logs
k8s-logs:
	kubectl -n offcon logs -l app=flag-verifier --tail=200 -f

.PHONY: openapi-validate
openapi-validate:
	@command -v openapi-cli >/dev/null || (echo "install @redocly/cli"; exit 1)
	openapi-cli lint api/openapi.yaml

.PHONY: clean
clean:
	rm -rf $(OUT) coverage.out
