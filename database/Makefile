# =============================================================================
# Offensive Conditions — Database Layer Makefile
# =============================================================================

.PHONY: help up down reset init migrate seed status psql logs clean

# Default goal
.DEFAULT_GOAL := help

# Configuration
DB_HOST ?= localhost
DB_PORT ?= 5432
DB_NAME ?= offcon
DB_ADMIN_USER ?= offcon_admin
DB_ADMIN_PASS ?= dev_only_change_in_prod
DB_MIGRATOR_USER ?= migrator
DB_MIGRATOR_PASS ?= dev_only_change_in_prod

# Colors
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
NC := \033[0m

help: ## Show this help
	@echo "$(CYAN)Offensive Conditions — Database Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start Postgres, Redis, MinIO via docker-compose
	@echo "$(CYAN)Starting database stack...$(NC)"
	docker compose up -d postgres redis minio adminer
	@echo "$(GREEN)Waiting for Postgres to be ready...$(NC)"
	@until docker exec offcon-postgres pg_isready -U $(DB_ADMIN_USER) -d $(DB_NAME) > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "$(GREEN)✓ Postgres ready at $(DB_HOST):$(DB_PORT)$(NC)"
	@echo "$(GREEN)✓ Adminer UI: http://localhost:8080$(NC)"
	@echo "$(GREEN)✓ MinIO Console: http://localhost:9001$(NC)"

down: ## Stop the database stack (data preserved)
	docker compose down

reset: ## DESTROY all data and recreate (DEV ONLY)
	@DB_HOST=$(DB_HOST) DB_PORT=$(DB_PORT) DB_NAME=$(DB_NAME) \
		DB_ADMIN_USER=$(DB_ADMIN_USER) DB_ADMIN_PASS=$(DB_ADMIN_PASS) \
		bash scripts/reset.sh

init: ## Apply init.sql (extensions, schemas, roles) — usually auto on first up
	@echo "$(CYAN)Running init.sql...$(NC)"
	@PGPASSWORD=$(DB_ADMIN_PASS) psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_ADMIN_USER) -d $(DB_NAME) \
		-f scripts/init.sql

migrate: ## Apply all migrations to current DB
	@DB_HOST=$(DB_HOST) DB_PORT=$(DB_PORT) DB_NAME=$(DB_NAME) \
		DB_USER=$(DB_MIGRATOR_USER) DB_PASS=$(DB_MIGRATOR_PASS) DB_SSLMODE=disable \
		bash scripts/apply_migrations.sh

migrate-schema: ## Apply migrations for a single schema. Usage: make migrate-schema SCHEMA=auth
	@if [ -z "$(SCHEMA)" ]; then echo "$(RED)SCHEMA not set. Usage: make migrate-schema SCHEMA=auth$(NC)"; exit 1; fi
	@migrate -path migrations/$(SCHEMA) \
		-database "postgres://$(DB_MIGRATOR_USER):$(DB_MIGRATOR_PASS)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=disable&x-migrations-table=schema_migrations_$(SCHEMA)" \
		up

rollback-schema: ## Rollback last migration of a schema. Usage: make rollback-schema SCHEMA=auth
	@if [ -z "$(SCHEMA)" ]; then echo "$(RED)SCHEMA not set$(NC)"; exit 1; fi
	@migrate -path migrations/$(SCHEMA) \
		-database "postgres://$(DB_MIGRATOR_USER):$(DB_MIGRATOR_PASS)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=disable&x-migrations-table=schema_migrations_$(SCHEMA)" \
		down 1

create-migration: ## Create empty migration files. Usage: make create-migration SCHEMA=auth NAME=add_xyz
	@if [ -z "$(SCHEMA)" ] || [ -z "$(NAME)" ]; then \
		echo "$(RED)Usage: make create-migration SCHEMA=auth NAME=add_users_table$(NC)"; exit 1; \
	fi
	@migrate create -ext sql -dir migrations/$(SCHEMA) -seq $(NAME)
	@echo "$(GREEN)✓ Created migration files in migrations/$(SCHEMA)/$(NC)"

seed: ## Load seed data into current DB (DEV ONLY)
	@echo "$(CYAN)Loading seed data...$(NC)"
	@for f in seeds/*.sql; do \
		echo "  → $$f"; \
		PGPASSWORD=$(DB_ADMIN_PASS) psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_ADMIN_USER) -d $(DB_NAME) -q -f "$$f" || exit 1; \
	done
	@echo "$(GREEN)✓ Seed data loaded$(NC)"

status: ## Show migration status per schema
	@echo "$(CYAN)Migration status:$(NC)"
	@PGPASSWORD=$(DB_ADMIN_PASS) psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_ADMIN_USER) -d $(DB_NAME) -t -A -F" | " <<-SQL || true
		SELECT table_schema, table_name FROM information_schema.tables \
		WHERE table_name LIKE 'schema_migrations_%' \
		ORDER BY table_name;
	SQL

psql: ## Open psql shell
	@PGPASSWORD=$(DB_ADMIN_PASS) psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_ADMIN_USER) -d $(DB_NAME)

psql-svc: ## Open psql as a service user. Usage: make psql-svc SVC=auth
	@if [ -z "$(SVC)" ]; then echo "$(RED)SVC not set. Usage: make psql-svc SVC=auth$(NC)"; exit 1; fi
	@PGPASSWORD=$(DB_ADMIN_PASS) psql -h $(DB_HOST) -p $(DB_PORT) -U svc_$(SVC) -d $(DB_NAME)

logs: ## Tail postgres logs
	docker compose logs -f postgres

clean: ## Stop stack and delete volumes (NUKE)
	@read -p "This will DELETE ALL DOCKER VOLUMES for offcon. Confirm with 'yes': " confirm; \
		if [ "$$confirm" != "yes" ]; then echo "Aborted."; exit 0; fi
	docker compose down -v
	@echo "$(GREEN)✓ Volumes removed$(NC)"

bootstrap: up init migrate seed ## One-command full setup: up + init + migrate + seed
	@echo ""
	@echo "$(GREEN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(GREEN)║  Database ready for development!                             ║$(NC)"
	@echo "$(GREEN)║                                                              ║$(NC)"
	@echo "$(GREEN)║  Postgres:    localhost:5432 / offcon                        ║$(NC)"
	@echo "$(GREEN)║  Adminer:     http://localhost:8080                          ║$(NC)"
	@echo "$(GREEN)║  Redis:       localhost:6379                                 ║$(NC)"
	@echo "$(GREEN)║  MinIO API:   localhost:9000                                 ║$(NC)"
	@echo "$(GREEN)║  MinIO UI:    http://localhost:9001                          ║$(NC)"
	@echo "$(GREEN)╚══════════════════════════════════════════════════════════════╝$(NC)"
