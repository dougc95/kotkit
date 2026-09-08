import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = import.meta.dirname

// Dev serves the SPA on 127.0.0.1:5173 and proxies /api to the Fastify API
// on 127.0.0.1:8787 (design.md's Runtime topology). The `@` alias resolves
// to `src` so app code and the component-test harness (src/test/*) can use
// stable `@/...` specifiers regardless of file depth.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
