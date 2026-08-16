# =============================================================================
# Content service Makefile
# =============================================================================

SHELL := /bin/bash
SVC := content-svc
IMAGE ?= harbor.offensiveconditions.org/services/$(SVC)
TAG ?= dev
NS ?= offcon

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# -----------------------------------------------------------------------------
# Local development
# -----------------------------------------------------------------------------

.PHONY: install
install: ## Install Python deps
	pip install -r requirements.txt

.PHONY: run-server
run-server: ## Run HTTP + gRPC server with hot reload
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8003

.PHONY: run-worker
run-worker: ## Run Celery worker
	celery -A app.workers.celery_app worker --loglevel=info --concurrency=4

.PHONY: run-beat
run-beat: ## Run Celery beat scheduler
	celery -A app.workers.celery_app beat --loglevel=info

# -----------------------------------------------------------------------------
# Migrations
# -----------------------------------------------------------------------------

.PHONY: migrate
migrate: ## Apply migrations
	alembic upgrade head

.PHONY: migrate-down
migrate-down: ## Roll back one migration
	alembic downgrade -1

.PHONY: migrate-new
migrate-new: ## Create new migration: make migrate-new name=add_foo_index
	alembic revision -m "$(name)"

.PHONY: migrate-autogen
migrate-autogen: ## Autogenerate migration from model diff: make migrate-autogen name=foo
	alembic revision --autogenerate -m "$(name)"

# -----------------------------------------------------------------------------
# Seed
# -----------------------------------------------------------------------------

.PHONY: seed-dev
seed-dev: ## Insert sample machines/challenges/paths for dev
	python -m scripts.seed_dev_content

# -----------------------------------------------------------------------------
# Lint + format + test
# -----------------------------------------------------------------------------

.PHONY: lint
lint: ## Run ruff + mypy
	ruff check app tests
	mypy app

.PHONY: fmt
fmt: ## Format with ruff
	ruff format app tests scripts
	ruff check --fix app tests scripts

.PHONY: test
test: ## Run pytest
	pytest -v --cov=app --cov-report=term-missing

.PHONY: test-fast
test-fast: ## Run pytest without coverage
	pytest -v

# -----------------------------------------------------------------------------
# gRPC stubs (CI only — bash sandbox lacks network)
# -----------------------------------------------------------------------------

.PHONY: gen-proto
gen-proto: ## Regenerate gRPC stubs from proto/ (requires CI)
	python -m grpc_tools.protoc \
		-I proto \
		--python_out=app/grpc/generated \
		--grpc_python_out=app/grpc/generated \
		proto/content.proto

# -----------------------------------------------------------------------------
# Docker
# -----------------------------------------------------------------------------

.PHONY: docker-build
docker-build: ## Build docker image
	docker build -t $(IMAGE):$(TAG) .

.PHONY: docker-push
docker-push: ## Push image to registry
	docker push $(IMAGE):$(TAG)

.PHONY: docker-run
docker-run: ## Run image locally for smoke testing
	docker run --rm -p 8003:8003 -p 9003:9003 \
		--env-file .env \
		$(IMAGE):$(TAG)

# -----------------------------------------------------------------------------
# Kubernetes
# -----------------------------------------------------------------------------

.PHONY: k8s-apply
k8s-apply: ## Apply manifests
	kubectl apply -f deployments/kubernetes.yaml -n $(NS)

.PHONY: k8s-delete
k8s-delete: ## Delete manifests
	kubectl delete -f deployments/kubernetes.yaml -n $(NS) --ignore-not-found

.PHONY: k8s-logs-server
k8s-logs-server: ## Tail server logs
	kubectl logs -n $(NS) -l app.kubernetes.io/component=server --tail=200 -f

.PHONY: k8s-logs-worker
k8s-logs-worker: ## Tail worker logs
	kubectl logs -n $(NS) -l app.kubernetes.io/component=worker --tail=200 -f

.PHONY: k8s-restart
k8s-restart: ## Rolling restart of server
	kubectl rollout restart deployment/content-svc-server -n $(NS)
