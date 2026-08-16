# syntax=docker/dockerfile:1.7
# =============================================================================
# Scoring service — multi-stage build
# Produces three distroless images: server, worker, seasonjob
#
# Usage:
#   docker build --target server   -t offcon/scoring-server:dev   .
#   docker build --target worker   -t offcon/scoring-worker:dev   .
#   docker build --target seasonjob -t offcon/scoring-seasonjob:dev .
# =============================================================================

FROM golang:1.22-bookworm AS builder
WORKDIR /src

# Cache deps first
ENV GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy source
COPY . .

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH}

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build -trimpath -ldflags "-s -w \
        -X github.com/offensive-conditions/scoring/internal/buildinfo.Version=${VERSION} \
        -X github.com/offensive-conditions/scoring/internal/buildinfo.Commit=${COMMIT} \
        -X github.com/offensive-conditions/scoring/internal/buildinfo.BuildDate=${BUILD_DATE}" \
    -o /out/scoring-server ./cmd/server && \
    go build -trimpath -ldflags "-s -w" -o /out/scoring-worker ./cmd/worker && \
    go build -trimpath -ldflags "-s -w" -o /out/scoring-seasonjob ./cmd/seasonjob

# =============================================================================
# Server image
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS server
USER nonroot:nonroot
WORKDIR /app
COPY --from=builder /out/scoring-server /app/scoring-server
EXPOSE 8003 9003
ENTRYPOINT ["/app/scoring-server"]

# =============================================================================
# Worker image
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS worker
USER nonroot:nonroot
WORKDIR /app
COPY --from=builder /out/scoring-worker /app/scoring-worker
EXPOSE 9003
ENTRYPOINT ["/app/scoring-worker"]

# =============================================================================
# Seasonjob image
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS seasonjob
USER nonroot:nonroot
WORKDIR /app
COPY --from=builder /out/scoring-seasonjob /app/scoring-seasonjob
EXPOSE 10003
ENTRYPOINT ["/app/scoring-seasonjob"]
