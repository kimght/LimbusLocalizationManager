# syntax=docker/dockerfile:1

FROM python:3.11-slim AS builder-base

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    UV_PYTHON=python3.11 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# --- Gist builder (no minio dependency) ---
FROM builder-base AS builder-gist

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY src ./src
RUN uv sync --frozen --no-editable

# --- Mirror builder (includes minio extra) ---
FROM builder-base AS builder-mirror

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --extra mirror --no-install-project

COPY src ./src
RUN uv sync --frozen --extra mirror --no-editable

# --- Shared runtime base ---
FROM python:3.11-slim AS runtime-base

ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
RUN adduser --disabled-password --gecos "" appuser

# --- Gist runtime target ---
FROM runtime-base AS gist

COPY --from=builder-gist --chown=appuser:appuser /app/.venv /app/.venv

USER appuser

ENTRYPOINT ["llm-updater"]
CMD ["gist", "--schedule", "--interval", "5"]

# --- Mirror runtime target ---
FROM runtime-base AS mirror

COPY --from=builder-mirror --chown=appuser:appuser /app/.venv /app/.venv

USER appuser

ENTRYPOINT ["llm-updater"]
CMD ["mirror", "--schedule", "--interval", "5"]
