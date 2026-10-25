FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# The core SDK and contract config, from the public repo at a pinned commit (not modified).
ARG CORE_COMMIT=d50b763
RUN git clone https://github.com/hustle1hustle/bookerbob-hackmeridian-2026.git .core && cd .core && git checkout ${CORE_COMMIT}
COPY src ./src
ENV PORT=8080 UCP_DATA_DIR=/tmp/ucp
EXPOSE 8080
CMD ["npx", "tsx", "src/bridge.ts"]
