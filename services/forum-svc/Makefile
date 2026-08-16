SHELL := /bin/bash
SVC := forum-svc
IMAGE ?= harbor.offensiveconditions.org/services/$(SVC)
TAG ?= dev
NS ?= offcon

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install
install: ## Install deps
	pip install -r requirements.txt

.PHONY: run-server
run-server: ## Run HTTP + gRPC server
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8005

.PHONY: run-worker
run-worker: ## Run Celery worker
	celery -A app.workers.celery_app worker --loglevel=info --concurrency=4

.PHONY: run-beat
run-beat: ## Run Celery beat
	celery -A app.workers.celery_app beat --loglevel=info

.PHONY: migrate
migrate: ## Apply migrations
	alembic upgrade head

.PHONY: migrate-new
migrate-new: ## Create migration: make migrate-new name=foo
	alembic revision -m "$(name)"

.PHONY: seed-dev
seed-dev: ## Seed sample categories + threads
	python -m scripts.seed_dev_forum

.PHONY: lint
lint: ## Lint
	ruff check app tests
	mypy app

.PHONY: fmt
fmt: ## Format
	ruff format app tests scripts
	ruff check --fix app tests scripts

.PHONY: test
test: ## Run tests
	pytest -v --cov=app --cov-report=term-missing

.PHONY: docker-build
docker-build: ## Build docker image
	docker build -t $(IMAGE):$(TAG) .

.PHONY: docker-push
docker-push:
	docker push $(IMAGE):$(TAG)

.PHONY: k8s-apply
k8s-apply: ## Apply manifests
	kubectl apply -f deployments/kubernetes.yaml -n $(NS)

.PHONY: k8s-delete
k8s-delete:
	kubectl delete -f deployments/kubernetes.yaml -n $(NS) --ignore-not-found

.PHONY: k8s-logs-server
k8s-logs-server:
	kubectl logs -n $(NS) -l app.kubernetes.io/component=server --tail=200 -f
