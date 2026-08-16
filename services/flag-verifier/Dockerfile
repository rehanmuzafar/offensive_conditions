# syntax=docker/dockerfile:1.7
FROM golang:1.22-bookworm AS builder
WORKDIR /src

ENV GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod tidy && go mod download

COPY . .

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH}

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build -trimpath -ldflags "-s -w \
        -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.Version=${VERSION} \
        -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.Commit=${COMMIT} \
        -X github.com/offensive-conditions/flag-verifier/internal/buildinfo.BuildDate=${BUILD_DATE}" \
    -o /out/flag-verifier ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
USER nonroot:nonroot
WORKDIR /app
COPY --from=builder /out/flag-verifier /app/flag-verifier
EXPOSE 8005
ENTRYPOINT ["/app/flag-verifier"]
