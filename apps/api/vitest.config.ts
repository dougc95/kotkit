import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 'src/**/*.test.ts' added by 4.1.1: group 4 onward keeps its pure-function
    // unit tests colocated under apps/api/src/services/**/*.test.ts (see
    // tasks-detail.md's "Group-4 unit test files stay under
    // apps/api/src/services/program/*.test.ts" decision) alongside the
    // pre-existing apps/api/test/**/*.test.ts integration suites.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: true,
    fileParallelism: false,
    globalSetup: ['./test/setup/globalSetup.ts'],
    setupFiles: ['./test/setup/env.ts'],
  },
})
