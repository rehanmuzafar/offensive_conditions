# syntax=docker/dockerfile:1.7
# =============================================================================
# Build stage
# =============================================================================
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Cache dependencies layer
ENV GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

# Source
COPY . .

# Static binary, stripped, with build info
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown

ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build \
    -trimpath \
    -ldflags="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.BuildDate=${BUILD_DATE}" \
    -o /out/auth \
    ./cmd/server

# =============================================================================
# Runtime stage — distroless for minimal attack surface
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot

LABEL org.opencontainers.image.title="offcon-auth"
LABEL org.opencontainers.image.description="Offensive Conditions authentication service"
LABEL org.opencontainers.image.vendor="Offensive Conditions"
LABEL org.opencontainers.image.source="https://github.com/offensive-conditions/platform"

# Copy timezone data and CA certs from builder
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy binary
COPY --from=builder /out/auth /app/auth

# Copy email templates
COPY --from=builder /build/templates /app/templates

# Run as non-root (provided by distroless nonroot tag → uid 65532)
USER 65532:65532

WORKDIR /app

ENV SMTP_TEMPLATES_DIR=/app/templates/email \
    APP_ENV=production \
    LOG_FORMAT=json

EXPOSE 8001 9001

ENTRYPOINT ["/app/auth"]
