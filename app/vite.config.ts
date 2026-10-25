import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

const sdk = fileURLToPath(new URL("../packages/sdk/src/index.ts", import.meta.url))
const parent = fileURLToPath(new URL("..", import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@bookerbob/pos-sdk": sdk } },
  // dev: the testnet SDK calls same-origin /api; forward it to the local backend (scripts/dev-server.sh),
  // or to another backend with API_PROXY=https://stellarbob2026.xyz
  server: { fs: { allow: [parent] }, proxy: { "/api": { target: process.env.API_PROXY ?? "http://localhost:8080", changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1500 },
  // no PostCSS: stops Vite from picking up a config from a parent directory
  css: { postcss: {} },
  // relative asset paths so the build works from any static host or subpath
  base: "./",
})
