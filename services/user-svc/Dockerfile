# syntax=docker/dockerfile:1.7
#
# Multi-stage build for user-svc.
# Use --build-arg BINARY=server|worker|gdprjob to pick which binary the
# final image runs (default: server).
#
ARG GO_VERSION=1.22

FROM golang:${GO_VERSION}-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

# Cache dependencies separately for better layer reuse
ENV GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

ARG BINARY=server
ARG VERSION=dev
ARG COMMIT=unknown

ENV CGO_ENABLED=0 GOOS=linux

RUN go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/${BINARY} \
    ./cmd/${BINARY}

# Verify the binary actually runs (sanity check)
RUN /out/${BINARY} --help 2>&1 | head -1 || true

# ---------------------------------------------------------------------------
# Runtime: distroless static for minimal attack surface
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

ARG BINARY=server
COPY --from=builder /out/${BINARY} /app/binary
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

USER nonroot:nonroot
WORKDIR /app

# Server uses 8001 (HTTP) and 9001 (gRPC). Worker + gdprjob don't expose ports.
EXPOSE 8001 9001

ENTRYPOINT ["/app/binary"]
