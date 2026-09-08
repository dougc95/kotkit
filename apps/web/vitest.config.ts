import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Deviation from design.md's binding text, recorded here (a D3/D16-D40-
 * adjacent implementation gap, not covered by either): the pinned
 * `vitest@5.0.0` (LIMITATIONS.md D3) does not implement `environmentMatchGlobs`
 * — it does not appear anywhere in that version's shipped type declarations
 * or runtime chunks, so `test.environmentMatchGlobs` fails to typecheck.
 * `projects` is Vitest 5's supported replacement for per-glob environment
 * selection and reproduces the same outcome the brief asks for: component
 * tests (`src/**\/*.test.tsx`) run in jsdom, plain lib unit tests
 * (`src/**\/*.test.ts`, 7.2/7.3) stay on the faster `node` environment. Each
 * project `extends: true` from this root config, so `setupFiles` and the
 * `@` alias below apply to both.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    setupFiles: ['src/test/setup.ts'],
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
})
