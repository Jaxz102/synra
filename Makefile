# Synra — common tasks. Run `make` or `make help` to list targets.
SHELL := /bin/bash
COMPOSE := docker compose
DB := synradb

.DEFAULT_GOAL := help
.PHONY: help start dev db db-wait db-reset migrate generate studio stop down restart logs psql poll build serve typecheck

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

start: node_modules migrate ## Start synradb, apply migrations, then the Next.js dev server (Ctrl+C stops the server; the db keeps running)
	bun run dev

dev: node_modules ## Start only the dev server
	bun run dev

db: ## Start the synradb Postgres container in OrbStack
	$(COMPOSE) up -d $(DB)

db-wait: db ## Start the db and block until Postgres accepts connections
	@printf "waiting for $(DB) to accept connections"
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' $(DB) 2>/dev/null)" = "healthy" ]; do printf "."; sleep 1; done
	@echo " ok"

db-reset: ## Destroy the synradb container AND its data volume, then recreate and migrate
	$(COMPOSE) down -v
	$(MAKE) migrate

migrate: db-wait ## Apply pending Drizzle migrations from drizzle/
	bun run db:migrate

generate: ## Diff lib/db/schema.ts against drizzle/ and write a new migration
	bun run db:generate

studio: ## Open Drizzle Studio against synradb
	bun run db:studio

stop: ## Stop the synradb container (data is kept)
	$(COMPOSE) stop $(DB)

down: ## Stop and remove the synradb container (data volume is kept)
	$(COMPOSE) down

restart: stop start ## Restart db and dev server

logs: ## Tail Postgres logs
	docker logs -f $(DB)

psql: ## Open psql inside the synradb container
	docker exec -it $(DB) psql -U synra -d synradb

poll: ## Run one poll from the CLI (pass ARGS="--limit 25")
	bun run scripts/poll.ts $(ARGS)

build: node_modules ## Production build
	bun run build

serve: build migrate ## Production server with the db
	bun run start

typecheck: node_modules ## Type-check the project
	bun run typecheck

node_modules: package.json bun.lock
	bun install
	@touch node_modules
