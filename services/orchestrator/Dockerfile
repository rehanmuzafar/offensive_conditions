# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /src

# Cache deps separately for fast rebuilds
ENV GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

ARG VERSION=dev
ARG BUILD_TIME
ARG GIT_COMMIT

ARG TARGETARCH
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=${TARGETARCH}

# Build all three binaries
RUN go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.buildTime=${BUILD_TIME} -X main.gitCommit=${GIT_COMMIT}" \
    -o /out/server \
    ./cmd/server

RUN go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/reaper \
    ./cmd/reaper

RUN go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/operator \
    ./cmd/operator

# =============================================================================
# Stage 2: Runtime (server - default)
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS server

COPY --from=builder /out/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

USER nonroot:nonroot

EXPOSE 8002 9002

ENTRYPOINT ["/server"]

# =============================================================================
# Stage 3: Runtime (reaper)
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS reaper

COPY --from=builder /out/reaper /reaper
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

USER nonroot:nonroot

ENTRYPOINT ["/reaper"]

# =============================================================================
# Stage 4: Runtime (operator)
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS operator

COPY --from=builder /out/operator /operator
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

USER nonroot:nonroot

EXPOSE 8080 8081

ENTRYPOINT ["/operator"]
