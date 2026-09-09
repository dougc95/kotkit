/**
 * Playwright config for the PITCH DEMO RECORDING — not part of the test
 * suite. `npm run e2e` never picks this up: its own config's project
 * `testMatch` patterns cover `e2e/*.spec.ts`, `e2e/{acceptance,invariants,
 * a11y}/*.spec.ts` and `e2e/support/helpers.spec.ts` only, and this file
 * lives in `e2e/pitch/`.
 *
 * It drives the REAL built application through the same single-origin
 * build-and-serve topology the acceptance project uses (D37), records video
 * at 1280x720, and writes it under `demo-output/`. Everything on screen is
 * the actual app running against the actual API; the only thing added is a
 * caption bar, which is clearly a caption and never covers or restates a
 * number the app itself renders.
 *
 * Run it with:
 *   npx playwright test -c e2e/pitch/pitch.config.ts
 */
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import type { DemoFixtures } from '../support/demo.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const ORIGIN = 'http://127.0.0.1:8788'
const WEB_DIST_DIR = path.resolve(REPO_ROOT, 'apps/web/dist')

export default defineConfig<DemoFixtures>({
  testDir: '.',
  testMatch: /pitch-demo\.spec\.ts$/,
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  // A narrated walkthrough deliberately pauses on each screen so a viewer can
  // read it; the whole recording is one test, so its timeout is the length of
  // the finished video plus headroom. Kept tight on purpose: a locator that
  // never resolves should end the take in a couple of minutes rather than
  // filming a frozen screen until a generous timeout expires.
  timeout: 8 * 60 * 1000,
  outputDir: path.resolve(REPO_ROOT, 'demo-output'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ORIGIN,
    apiBaseURL: `${ORIGIN}/api/v1/`,
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    // Slows every input so a viewer can follow the pointer rather than seeing
    // state change instantly between frames.
    launchOptions: { slowMo: 250 },
  },
  webServer: [
    {
      command: 'npm run build && npm run start -w @attention-lab/api',
      cwd: REPO_ROOT,
      env: {
        IDENTITY_MODE: 'local-demo',
        API_HOST: '127.0.0.1',
        API_PORT: '8788',
        WEB_DIST_DIR,
      },
      url: `${ORIGIN}/api/v1/me`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
})
