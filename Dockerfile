# Proof of Stay: BookerBob backend + static app on one Node process.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY server/package.json server/
COPY scripts/package.json scripts/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY server server
COPY config config

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=build /repo /repo
EXPOSE 8080
CMD ["node", "server/src/index.ts"]
