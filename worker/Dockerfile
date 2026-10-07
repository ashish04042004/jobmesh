# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
RUN npm ci --omit=dev --workspace=worker --workspace=shared && npm cache clean --force

COPY shared/ shared/
COPY worker/src/ worker/src/

RUN mkdir -p /data/uploads /data/outputs && chown -R node:node /data
USER node

CMD ["node", "worker/src/worker.js"]
