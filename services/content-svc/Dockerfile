# syntax=docker/dockerfile:1.6

# =============================================================================
# Stage 1: builder — install deps in a virtualenv
# =============================================================================
FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Build deps (libpq for psycopg, build-essential for compiled wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libffi-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install into a venv we can copy out clean
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Stage 2: runtime — slim image, non-root user
# =============================================================================
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    APP_HOME=/srv/app

# Runtime libs only
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 10001 app && \
    useradd  --system --uid 10001 --gid app --home-dir $APP_HOME --shell /bin/false app && \
    mkdir -p $APP_HOME && chown app:app $APP_HOME

WORKDIR $APP_HOME

COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app . $APP_HOME

USER app

# HTTP + gRPC ports
EXPOSE 8003 9003

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${HTTP_PORT:-8010}/livez || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command: HTTP + gRPC server. Override for celery worker / beat.
CMD ["sh", "-c", "exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:${HTTP_PORT:-8010} --access-logfile - --graceful-timeout 30 --timeout 60"]
