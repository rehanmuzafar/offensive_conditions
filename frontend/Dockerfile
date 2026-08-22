# ============================================================================
#  OFFCON frontend — multi-stage Next.js 15 production image.
#  Uses Next's standalone output for a tiny runtime image, runs as non-root,
#  and is multi-arch friendly (built by the build-push action).
# ============================================================================

# ---- deps: install production-resolved node_modules ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm install

# ---- builder: compile the Next.js app ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined at build time; CI passes the prod value.
# NEXT_PUBLIC_* is inlined by Next at build time, so every one of them needs an
# ARG here as well as a build arg in compose. A value passed by compose with no
# matching ARG is silently dropped: the image builds, boots healthy, and the
# variable is simply empty in the bundle.
ARG NEXT_PUBLIC_API_BASE_URL=https://api.offensiveconditions.org
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# Root domain the surfaces hang off. Empty means "one origin", which is what
# collapses every cross-surface link back to a plain path.
ARG NEXT_PUBLIC_ROOT_DOMAIN=
ENV NEXT_PUBLIC_ROOT_DOMAIN=${NEXT_PUBLIC_ROOT_DOMAIN}
RUN npm run build

# ---- runner: minimal standalone runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public dir
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Lightweight liveness check. We hit the root page rather than /api/* because
# /api/* is rewritten to the API gateway (see next.config.mjs) and isn't a
# local liveness signal.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
