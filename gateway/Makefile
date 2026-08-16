SHELL := /bin/bash
IMAGE ?= harbor.offensiveconditions.org/gateway/healthcheck
TAG ?= dev
ISTIO_VERSION ?= 1.24.1

.DEFAULT_GOAL := help

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# -----------------------------------------------------------------------------
# Healthcheck binary
# -----------------------------------------------------------------------------
.PHONY: build
build: ## Build the healthcheck binary
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/healthcheck ./cmd/healthcheck

.PHONY: test
test: ## Run Go tests
	go test ./... -race -count=1

.PHONY: vet
vet: ## go vet
	go vet ./...

.PHONY: fmt
fmt: ## gofmt
	gofmt -w -s ./cmd ./internal

.PHONY: docker-build
docker-build: ## Build the healthcheck image
	docker build -t $(IMAGE):$(TAG) .

.PHONY: docker-push
docker-push:
	docker push $(IMAGE):$(TAG)

# -----------------------------------------------------------------------------
# Route table validation
# -----------------------------------------------------------------------------
.PHONY: validate
validate: ## Validate the route registry for overlaps + completeness
	./scripts/validate.sh

# -----------------------------------------------------------------------------
# Istio install
# -----------------------------------------------------------------------------
.PHONY: istio-install
istio-install: ## Install the Istio control plane
	istioctl install -f deployments/istio/operator.yaml -y

.PHONY: istio-precheck
istio-precheck: ## Pre-flight check the cluster for Istio
	istioctl x precheck

.PHONY: istio-verify
istio-verify: ## Verify the Istio install
	istioctl verify-install -f deployments/istio/operator.yaml

# -----------------------------------------------------------------------------
# Apply everything (order matters)
# -----------------------------------------------------------------------------
.PHONY: apply-namespaces
apply-namespaces:
	kubectl apply -f deployments/istio/namespaces.yaml

.PHONY: apply-certs
apply-certs:
	kubectl apply -f deployments/cert-manager/

.PHONY: apply-gateway
apply-gateway:
	kubectl apply -f deployments/istio/gateway.yaml
	kubectl apply -f deployments/istio/service-entries.yaml

.PHONY: apply-security
apply-security:
	kubectl apply -f deployments/policies/security/

.PHONY: apply-routes
apply-routes:
	kubectl apply -f deployments/routes/

.PHONY: apply-authz
apply-authz:
	kubectl apply -f deployments/policies/authz/

.PHONY: apply-ratelimit
apply-ratelimit:
	kubectl apply -f deployments/policies/ratelimit/

.PHONY: apply-observability
apply-observability:
	kubectl apply -f deployments/observability/

.PHONY: apply-healthcheck
apply-healthcheck:
	kubectl apply -f deployments/gateway-healthcheck.yaml

.PHONY: apply-all
apply-all: apply-namespaces apply-certs apply-gateway apply-security apply-routes apply-authz apply-ratelimit apply-observability apply-healthcheck ## Apply the full gateway stack
	@echo "Gateway stack applied. Verify with: make smoke"

# -----------------------------------------------------------------------------
# Smoke test
# -----------------------------------------------------------------------------
.PHONY: smoke
smoke: ## Run smoke tests against the deployed gateway
	./scripts/smoke.sh

.PHONY: analyze
analyze: ## istioctl analyze for config issues
	istioctl analyze -n gateway-system -n offcon
