import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import type { DemoFixtures } from './support/demo.js'

const API_URL = 'http://127.0.0.1:8787'
const WEB_URL = 'http://127.0.0.1:5173'

/**
 * D37's single-origin build-and-serve topology (task 9.1.1) — a DIFFERENT
 * port from `API_URL` above: Playwright's `webServer` array starts every
 * entry for ANY run through this one config file (see the dev-server-pair
 * comment below), so this server and `dev:api` would otherwise both try to
 * bind 127.0.0.1:8787 at once. Task 9.1.1's own brief names 8787 for this
 * origin, written before the dev-server-pair stopgap (7.1.5, group 8) had
 * already claimed it — 8788 is the reconciliation the ORIGINAL webServer
 * comment already predicted ("most likely: a different port for the built
 * app"). One origin serves both the built web app and `/api/v1/*`, so a
 * single URL covers both `page.goto()` (`baseURL`) and `demo`'s raw API
 * calls (`apiBaseURL`, `e2e/support/demo.ts`'s per-project test option).
 */
const ACCEPTANCE_ORIGIN = 'http://127.0.0.1:8788'
const ACCEPTANCE_WEB_DIST_DIR = path.resolve(import.meta.dirname, '../apps/web/dist')

export default defineConfig<DemoFixtures>({
  testDir: '.',
  reporter: 'list',
  // Every spec that talks to the API shares ONE local-demo principal's
  // server-side state (one Postgres row set, no per-test isolation) and
  // most call `demo.reset()`/`demo.load()` in their own beforeEach — running
  // spec files concurrently (Playwright's own default) would let one file's
  // reset wipe out state a DIFFERENT file's concurrently-running test still
  // depends on. Serializing here is the correct fix for this architecture,
  // not a workaround for a specific flake.
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
  /**
   * Task 7.1.5: the dev-server pair the `shell`/`acceptance-dev` projects
   * run against. Playwright's `webServer` option is config-wide, not
   * per-project (there is no per-project equivalent), so every entry here
   * starts for ANY run through this config file — including the
   * `toolchain` project, which needs none of them, and the `acceptance`
   * project, which only needs the third entry below. `reuseExistingServer`
   * keeps a developer's own already-running `dev:api`/`dev:web` (or a
   * still-live acceptance server from a previous run) in place instead of
   * fighting over the port.
   *
   * The third entry is D37's single-origin build-and-serve path (task
   * 9.1.1) — `npm run build` (shared -> api -> web, so `apps/web/dist`
   * exists) then the API's own `start` script with `WEB_DIST_DIR` pointed
   * at that build output (3.2.5's static-serving plugin) and `API_PORT`
   * overridden to `ACCEPTANCE_ORIGIN`'s port, isolated per-project via
   * `POST /demo/reset`/`demo.load()` inside each spec rather than via a
   * separate database. `WEB_DIST_DIR` is an ABSOLUTE path deliberately:
   * `npm run start -w @attention-lab/api` runs with its CWD set to
   * `apps/api/` (npm workspace semantics — the sibling `dev` script's own
   * `--env-file-if-exists=../../.env` only makes sense under that same
   * assumption), so a relative `apps/web/dist` would resolve against the
   * wrong directory.
   */
  webServer: [
    {
      command: 'npm run dev:api',
      cwd: '..',
      env: {
        IDENTITY_MODE: 'local-demo',
        API_HOST: '127.0.0.1',
      },
      url: `${API_URL}/api/v1/me`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:web',
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run build && npm run start -w @attention-lab/api',
      cwd: '..',
      env: {
        IDENTITY_MODE: 'local-demo',
        API_HOST: '127.0.0.1',
        API_PORT: '8788',
        WEB_DIST_DIR: ACCEPTANCE_WEB_DIST_DIR,
      },
      url: `${ACCEPTANCE_ORIGIN}/api/v1/me`,
      reuseExistingServer: true,
      // A full monorepo build (shared -> api typecheck -> web build) before
      // the server even starts listening is real time no other entry here
      // spends — comfortably longer than the dev-server entries' 30s.
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'toolchain',
      testMatch: 'toolchain.smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shell',
      testMatch: 'smoke/shell.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    },
    /**
     * Group 8's own e2e tasks (8.1.4, 8.3.4, 8.4.6, ...) each specify
     * `npx playwright test e2e/<name>.spec.ts` as their verify command,
     * against the SAME dev-server pair `shell` already runs on — none of
     * them need design.md's single-origin build-and-serve topology.
     *
     * The regex matches against the file's ABSOLUTE path (confirmed
     * empirically against this Playwright version — an earlier `^`-anchored
     * pattern intended for a relative basename never matched anything, since
     * an absolute path always has a drive letter/directory prefix), so it is
     * anchored on `.../e2e/<name>.spec.ts` with no further path segment
     * between `e2e` and the filename — that's what keeps `smoke/shell.spec.ts`
     * and `toolchain.smoke.spec.ts` (a literal dot inside the basename,
     * which `[a-z0-9-]+` cannot match) out, without a subdirectory exclusion
     * list to keep in sync as new subdirectories (`support/`, `acceptance/`,
     * `invariants/`, `a11y/`) appear. `[\\/]` covers both Windows backslash
     * and POSIX forward-slash separators.
     */
    {
      name: 'acceptance-dev',
      testMatch: /[\\/]e2e[\\/][a-z0-9-]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    },
    /**
     * Task 9.1.1: D37's single-origin acceptance harness. Every Group 9
     * spec lives under `e2e/acceptance/`, `e2e/invariants/` or `e2e/a11y/`
     * (each `<name>.spec.ts`), except 9.1.2's own helper-verification spec
     * at `e2e/support/helpers.spec.ts` — matched explicitly since it sits
     * one level up from those three, alongside the (non-spec) support
     * modules it verifies. `fullyParallel: false` is explicit here (task
     * 9.1.1's own brief names it) even though it is already this project's
     * effective default; the global `workers: 1`/default `retries: 0`
     * above already satisfy the rest of that brief's harness requirements.
     */
    {
      name: 'acceptance',
      fullyParallel: false,
      testMatch: [
        /[\\/]acceptance[\\/][a-z0-9-]+\.spec\.ts$/,
        /[\\/]invariants[\\/][a-z0-9-]+\.spec\.ts$/,
        /[\\/]a11y[\\/][a-z0-9-]+\.spec\.ts$/,
        /[\\/]support[\\/]helpers\.spec\.ts$/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ACCEPTANCE_ORIGIN,
        apiBaseURL: `${ACCEPTANCE_ORIGIN}/api/v1/`,
      },
    },
  ],
})
