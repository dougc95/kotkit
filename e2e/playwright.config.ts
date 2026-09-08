import { defineConfig, devices } from '@playwright/test'

const API_URL = 'http://127.0.0.1:8787'
const WEB_URL = 'http://127.0.0.1:5173'

export default defineConfig({
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
   * Task 7.1.5: the dev-server pair the `shell` project below runs against.
   * Playwright's `webServer` option is config-wide, not per-project (there
   * is no per-project equivalent), so both entries here start for ANY run
   * through this config file — including the `toolchain` project, which
   * needs neither and starts them anyway. `reuseExistingServer` keeps a
   * developer's own already-running `dev:api`/`dev:web` in place instead of
   * fighting over the port.
   *
   * This is deliberately a DEV-server pair (`npm run dev:api` / `dev:web`,
   * two origins, the Vite proxy from 7.1.1 carrying `/api`) rather than
   * design.md's single-origin build-and-serve path (`npm run build` then
   * the API with `WEB_DIST_DIR` set, D37) — no task in this change owns
   * standing that path up yet. 9.1.1 is expected to add an `acceptance`
   * project on top of THIS SAME config (1.5.3's own header comment says so)
   * with a build-and-serve `webServer` entry of its own; because `webServer`
   * is config-wide, reconciling that with the two dev-server entries below
   * (most likely: a different port for the built app, since 8787 is already
   * claimed by `dev:api`) is that task's decision to make, not this one's.
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
     * them need design.md's single-origin build-and-serve topology. That
     * path (D37, task 9.1.1, "on top of THIS SAME config" per this file's
     * own webServer comment) is a later, separate concern: a build-and-serve
     * `acceptance` project reconciling the config-wide `webServer` array
     * with the two dev-server entries above. This project only fills the
     * narrower, immediate gap — a project whose `testMatch` actually covers
     * Group 8's top-level `e2e/*.spec.ts` files, which no existing project
     * did (`toolchain`/`shell` each match one specific file).
     *
     * The regex matches against the file's ABSOLUTE path (confirmed
     * empirically against this Playwright version — an earlier `^`-anchored
     * pattern intended for a relative basename never matched anything, since
     * an absolute path always has a drive letter/directory prefix), so it is
     * anchored on `.../e2e/<name>.spec.ts` with no further path segment
     * between `e2e` and the filename — that's what keeps `smoke/shell.spec.ts`
     * and `toolchain.smoke.spec.ts` (a literal dot inside the basename,
     * which `[a-z0-9-]+` cannot match) out, without a subdirectory exclusion
     * list to keep in sync as new subdirectories (`support/`, `helpers/`)
     * appear. `[\\/]` covers both Windows backslash and POSIX forward-slash
     * separators.
     */
    {
      name: 'acceptance-dev',
      testMatch: /[\\/]e2e[\\/][a-z0-9-]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    },
  ],
})
