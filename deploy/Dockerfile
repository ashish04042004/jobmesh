# Single-container image (API + workers + dashboard). Build context is the repo root.
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    STATIC_DIR=/app/public
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
RUN npm ci --omit=dev --workspace=backend --workspace=worker --workspace=shared && npm cache clean --force

COPY shared/ shared/
COPY backend/src/ backend/src/
COPY worker/src/ worker/src/
COPY deploy/standalone.js deploy/
COPY --from=web /web/dist/ public/

RUN mkdir -p /data/uploads /data/outputs && chown -R node:node /data
USER node

EXPOSE 4000
CMD ["node", "deploy/standalone.js"]
