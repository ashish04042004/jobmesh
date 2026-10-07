# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
RUN npm ci --omit=dev --workspace=backend --workspace=shared && npm cache clean --force

COPY shared/ shared/
COPY backend/src/ backend/src/

RUN mkdir -p /data/uploads /data/outputs && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/src/server.js"]
