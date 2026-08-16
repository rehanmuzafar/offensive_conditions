SHELL := /bin/bash
SVC := notification-svc
IMAGE ?= harbor.offensiveconditions.org/services/$(SVC)
TAG ?= dev
NS ?= offcon

.DEFAULT_GOAL := help

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install
install: ## Install npm deps
	npm ci

.PHONY: build
build: ## Build TypeScript
	npm run build

.PHONY: run-server
run-server: ## Run HTTP + gRPC server (dev)
	npm run dev

.PHONY: run-worker
run-worker: ## Run BullMQ worker (dev)
	npm run worker:dev

.PHONY: run-consumer
run-consumer: ## Run Kafka consumer (dev)
	npm run consumer:dev

.PHONY: migrate
migrate: ## Apply migrations
	npm run db:migrate

.PHONY: migrate-down
migrate-down: ## Roll back one migration
	npm run db:rollback

.PHONY: seed-dev
seed-dev: ## Seed sample templates + preferences
	npm run seed:dev

.PHONY: lint
lint:
	npm run lint

.PHONY: fmt
fmt:
	npm run fmt

.PHONY: typecheck
typecheck:
	npm run typecheck

.PHONY: test
test:
	npm test

.PHONY: docker-build
docker-build:
	docker build -t $(IMAGE):$(TAG) .

.PHONY: docker-push
docker-push:
	docker push $(IMAGE):$(TAG)

.PHONY: k8s-apply
k8s-apply:
	kubectl apply -f deployments/kubernetes.yaml -n $(NS)

.PHONY: k8s-delete
k8s-delete:
	kubectl delete -f deployments/kubernetes.yaml -n $(NS) --ignore-not-found

.PHONY: k8s-logs-server
k8s-logs-server:
	kubectl logs -n $(NS) -l app.kubernetes.io/component=server --tail=200 -f

.PHONY: k8s-logs-worker
k8s-logs-worker:
	kubectl logs -n $(NS) -l app.kubernetes.io/component=worker --tail=200 -f

.PHONY: k8s-logs-consumer
k8s-logs-consumer:
	kubectl logs -n $(NS) -l app.kubernetes.io/component=consumer --tail=200 -f
