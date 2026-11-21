FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee AS edge
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
ENV PLAYGROUND_ONLY=1 PLAYGROUND_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim
COPY --from=uv /uv /bin/uv
COPY --from=edge /usr/bin/caddy /usr/bin/caddy
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    uv sync --frozen --no-dev
COPY --chown=10001:10001 backend/app/__init__.py ./app/
COPY --chown=10001:10001 backend/app/playground ./app/playground
COPY --chown=10001:10001 backend/app/domain/__init__.py backend/app/domain/scheduling.py backend/app/domain/tasks.py ./app/domain/
COPY --chown=10001:10001 backend/app/adapters/__init__.py backend/app/adapters/errors.py backend/app/adapters/types.py ./app/adapters/
COPY --chown=10001:10001 backend/app/adapters/reservations/__init__.py backend/app/adapters/reservations/mock.py ./app/adapters/reservations/
COPY --chown=10001:10001 --from=web /web/.next/standalone /web
COPY --chown=10001:10001 --from=web /web/.next/static /web/.next/static
COPY --chown=10001:10001 --from=web /web/public /web/public
COPY --chmod=644 infra/playground/railway/Caddyfile infra/playground/railway/start.sh /opt/playground/
ENV PLAYGROUND_ONLY=1 NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
CMD ["bash", "/opt/playground/start.sh"]
