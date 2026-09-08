/**
 * Shell smoke test (task 7.1.5; app-shell spec: "Navigation exists outside
 * session mode only" / "Navigation on Today", "Responsive layout";
 * identity-realm: "Demo mode is permanently and unmistakably labeled" /
 * "Banner on every screen"). Three cases, run against the real dev servers
 * (`webServer` array in `../playwright.config.ts`'s `shell` project) rather
 * than component-mounted: this is the one check that `RailLayout`,
 * `SessionLayout` and `DemoBanner` are actually reachable through the real
 * router, over the real Vite proxy, against the real API — everything
 * `RailLayout.test.tsx`/`SessionLayout.test.tsx`/`router.test.tsx` already
 * cover in isolation, seen end to end for the first time.
 *
 * `demo.reset()` in `beforeEach` keeps the principal's demo data
 * deterministic regardless of what an earlier spec run left behind, and
 * exercises the `demo` fixture itself as part of this being the FIRST e2e
 * unit to run against a live server. It IS load-bearing for the session-mode
 * case below, now that Group 8 replaced every route's `ScreenPlaceholder`
 * with its real screen: a reset with no program means `/benchmark/:slotId`
 * renders `Ready`'s own "Benchmark slot not found" (it never redirects away
 * from session mode for an unmatched slot, unlike `Focus`/`Recall`/etc.,
 * which 404-redirect to `/today` for an unmatched *session* id — this test
 * originally used a fake `/focus/:sessionId`, which broke exactly that way
 * once Focus became real).
 */
import { expect, test } from '../support/demo.js'
import { expectDemoBanner } from '../support/copy.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('desktop: banner and rail navigation render on Today', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/today')

  await expectDemoBanner(page)

  const nav = page.locator('nav[data-placement="rail"]')
  await expect(nav).toBeVisible()
  for (const label of ['Today', 'Progress', 'Research', 'Settings']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }
})

test('mobile: banner and bottom navigation render on Today with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/today')

  await expectDemoBanner(page)

  const nav = page.locator('nav[data-placement="bottom"]')
  await expect(nav).toBeVisible()

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
})

test('session mode: banner renders with no navigation landmark', async ({ page }) => {
  // A fake slot id under a session-mode route: `Ready` (mounted by
  // `BenchmarkRoute` at this path) renders its own inline "not found" state
  // rather than redirecting, so `SessionLayout` stays mounted with no nav —
  // unlike a fake *session* id (`/focus/:sessionId` etc.), which 404s and
  // redirects to `/today`.
  await page.goto('/benchmark/00000000-0000-0000-0000-000000000000')

  const banner = page.getByRole('complementary', { name: 'Demonstration data notice' })
  await expect(banner).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
})
