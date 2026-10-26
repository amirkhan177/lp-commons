# Build context: repository root (needs db/migrations alongside pipelines/).
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app/pipelines
COPY pipelines/pyproject.toml pipelines/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY pipelines/src ./src
RUN uv sync --frozen --no-dev
COPY db /app/db

ENV PATH="/app/pipelines/.venv/bin:$PATH" \
    LPMAP_MIGRATIONS_DIR=/app/db/migrations \
    PYTHONUNBUFFERED=1

CMD ["lpmap", "sync"]
