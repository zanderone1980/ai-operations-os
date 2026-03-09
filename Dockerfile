# AI Operations OS — Multi-stage Docker build
# Produces a minimal production image for the ops-api server.

# ── Stage 1: Install + Build ──────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json turbo.json tsconfig.json ./
COPY packages/shared-types/package.json   packages/shared-types/
COPY packages/ops-core/package.json       packages/ops-core/
COPY packages/ops-policy/package.json     packages/ops-policy/
COPY packages/ops-connectors/package.json packages/ops-connectors/
COPY packages/ops-storage/package.json    packages/ops-storage/
COPY packages/codebot-adapter/package.json packages/codebot-adapter/
COPY packages/cord-adapter/package.json   packages/cord-adapter/
COPY apps/ops-api/package.json            apps/ops-api/
COPY apps/ops-worker/package.json         apps/ops-worker/
COPY apps/ops-web/package.json            apps/ops-web/

RUN npm ci --ignore-scripts

# Copy source and build
COPY packages/ packages/
COPY apps/ apps/

RUN npx turbo build

# ── Stage 2: Production image ────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

# Create non-root user
RUN groupadd -r aiops && useradd -r -g aiops -m aiops

# Copy built artifacts and node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/ apps/

# Copy web dashboard static files
COPY --from=builder /app/apps/ops-web/src/ apps/ops-web/src/

# Create data directory
RUN mkdir -p /home/aiops/.ai-ops && chown -R aiops:aiops /home/aiops/.ai-ops

# Environment defaults
ENV NODE_ENV=production
ENV OPS_PORT=3100
ENV OPS_HOST=0.0.0.0
ENV OPS_DB_PATH=/home/aiops/.ai-ops/data.db

EXPOSE 3100

USER aiops

CMD ["node", "apps/ops-api/dist/server.js"]
