# Build from the repo root: fly deploy --config ucp/fly.toml --dockerfile ucp/Dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY server/package.json ./server/package.json
COPY scripts/package.json ./scripts/package.json
COPY app/package.json ./app/package.json
COPY agent/package.json ./agent/package.json
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts
COPY config ./config
COPY ucp/package.json ucp/package-lock.json ./ucp/
RUN cd ucp && npm ci
COPY ucp/src ./ucp/src
WORKDIR /app/ucp
ENV PORT=8080 UCP_DATA_DIR=/tmp/ucp
EXPOSE 8080
CMD ["npx", "tsx", "src/bridge.ts"]
