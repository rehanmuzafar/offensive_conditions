SHELL := /bin/bash
SVC := ctf-svc
IMAGE ?= harbor.offensiveconditions.org/services/$(SVC)
TAG ?= dev
NS ?= offcon

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install
install: ## Install Python deps
	pip install -r requirements.txt

.PHONY: run-server
run-server: ## Run HTTP + gRPC + WebSocket server
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8004

.PHONY: run-worker
run-worker: ## Run Celery worker
	celery -A app.workers.celery_app worker --loglevel=info --concurrency=4

.PHONY: run-beat
run-beat: ## Run Celery beat
	celery -A app.workers.celery_app beat --loglevel=info

.PHONY: run-kafka-consumer
run-kafka-consumer: ## Run Kafka consumer
	python -m app.workers.kafka_consumer

.PHONY: migrate
migrate: ## Apply migrations
	alembic upgrade head

.PHONY: migrate-down
migrate-down: ## Roll back one migration
	alembic downgrade -1

.PHONY: migrate-new
migrate-new: ## Create new migration: make migrate-new name=add_foo
	alembic revision -m "$(name)"

.PHONY: seed-dev
seed-dev: ## Seed dev event + challenges
	python -m scripts.seed_dev_ctf

.PHONY: lint
lint: ## Run ruff + mypy
	ruff check app tests
	mypy app

.PHONY: fmt
fmt: ## Format code
	ruff format app tests scripts
	ruff check --fix app tests scripts

.PHONY: test
test: ## Run pytest with coverage
	pytest -v --cov=app --cov-report=term-missing

.PHONY: test-fast
test-fast: ## Run pytest quickly
	pytest -v

.PHONY: gen-proto
gen-proto: ## Regenerate gRPC stubs (CI only)
	python -m grpc_tools.protoc \
		-I proto \
		--python_out=app/grpc/generated \
		--grpc_python_out=app/grpc/generated \
		proto/ctf.proto

.PHONY: docker-build
docker-build: ## Build docker image
	docker build -t $(IMAGE):$(TAG) .

.PHONY: docker-push
docker-push: ## Push image
	docker push $(IMAGE):$(TAG)

.PHONY: docker-run
docker-run: ## Run image locally
	docker run --rm -p 8004:8004 -p 9004:9004 \
		--env-file .env \
		$(IMAGE):$(TAG)

.PHONY: k8s-apply
k8s-apply: ## Apply K8s manifests
	kubectl apply -f deployments/kubernetes.yaml -n $(NS)

.PHONY: k8s-delete
k8s-delete: ## Delete K8s manifests
	kubectl delete -f deployments/kubernetes.yaml -n $(NS) --ignore-not-found

.PHONY: k8s-logs-server
k8s-logs-server: ## Tail server logs
	kubectl logs -n $(NS) -l app.kubernetes.io/component=server --tail=200 -f

.PHONY: k8s-logs-worker
k8s-logs-worker: ## Tail worker logs
	kubectl logs -n $(NS) -l app.kubernetes.io/component=worker --tail=200 -f

.PHONY: k8s-restart
k8s-restart: ## Rolling restart of server
	kubectl rollout restart deployment/ctf-svc-server -n $(NS)
