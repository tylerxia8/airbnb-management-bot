FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
ENV PLAYGROUND_ONLY=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build && chown -R node:node /app/.next
USER node
CMD ["npm", "start"]
