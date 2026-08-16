# syntax=docker/dockerfile:1.6
# =============================================================================
# Stage 1: deps + build
# =============================================================================
FROM node:20-bookworm-slim AS builder

ENV NODE_ENV=development

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 build-essential libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
RUN npm install --no-save --ignore-scripts tsc-alias

COPY . .
RUN npm run build && ./node_modules/.bin/tsc-alias -p tsconfig.json

# =============================================================================
# Stage 2: prune to production deps
# =============================================================================
FROM node:20-bookworm-slim AS production-deps

WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

# =============================================================================
# Stage 3: runtime
# =============================================================================
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    APP_HOME=/srv/app \
    NODE_OPTIONS=--enable-source-maps

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 app && \
    useradd  --system --uid 10001 --gid app --home-dir $APP_HOME --shell /bin/false app && \
    mkdir -p $APP_HOME && chown app:app $APP_HOME

WORKDIR $APP_HOME

COPY --from=production-deps --chown=app:app /build/node_modules ./node_modules
COPY --from=builder --chown=app:app /build/dist ./dist
COPY --from=builder --chown=app:app /build/package.json ./package.json
COPY --from=builder --chown=app:app /build/proto ./proto

USER app

EXPOSE 8008 9008

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8008/livez || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# Default: HTTP + gRPC server.
# Override CMD to "node dist/worker.js" for BullMQ workers.
# Override CMD to "node dist/consumer.js" for Kafka consumer.
CMD ["node", "dist/server.js"]
