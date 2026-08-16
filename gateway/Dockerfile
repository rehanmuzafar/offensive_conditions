# syntax=docker/dockerfile:1.6
# =============================================================================
# Multi-stage build for the gateway healthcheck aggregator
# =============================================================================
FROM golang:1.23-bookworm AS builder

WORKDIR /build

# Cache deps (no external deps, but keeps the pattern consistent)
COPY go.mod ./
RUN go mod download 2>/dev/null || true

COPY . .

# Static build — no CGO, stripped, reproducible
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
      -trimpath \
      -ldflags="-s -w -X main.version=$(cat VERSION 2>/dev/null || echo dev)" \
      -o /out/healthcheck \
      ./cmd/healthcheck

# =============================================================================
# Runtime — distroless static
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/healthcheck /healthcheck

USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["/healthcheck"]
