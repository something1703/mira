# mira-engines: Python measurement maths. Build from the repo root:
#   docker build -f infra/docker/engines.Dockerfile -t mira-engines .
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY services/engines/pyproject.toml services/engines/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/engines/mira_engines ./mira_engines
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
# MediaPipe needs these shared libraries at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER nobody
CMD ["sh", "-c", "uvicorn mira_engines.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
