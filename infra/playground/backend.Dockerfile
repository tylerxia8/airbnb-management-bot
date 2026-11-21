FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    uv sync --frozen --no-dev && mkdir /sandbox && chown 10001:10001 /sandbox
COPY app/__init__.py ./app/
COPY app/playground ./app/playground
COPY app/domain/__init__.py app/domain/scheduling.py app/domain/tasks.py ./app/domain/
COPY app/adapters/__init__.py app/adapters/errors.py app/adapters/types.py ./app/adapters/
COPY app/adapters/reservations/__init__.py app/adapters/reservations/mock.py ./app/adapters/reservations/
USER 10001:10001
ENV PLAYGROUND_DB=/sandbox/playground.sqlite3
CMD ["/app/.venv/bin/uvicorn", "app.playground.server:factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--no-proxy-headers", "--limit-concurrency", "32"]
