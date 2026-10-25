import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

const sdk = fileURLToPath(new URL("../packages/sdk/src/index.ts", import.meta.url))
const parent = fileURLToPath(new URL("..", import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@bookerbob/pos-sdk": sdk } },
  server: { fs: { allow: [parent] } },
  // no PostCSS: stops Vite from picking up a config from a parent directory
  css: { postcss: {} },
  // relative asset paths so the build works from any static host or subpath
  base: "./",
})
