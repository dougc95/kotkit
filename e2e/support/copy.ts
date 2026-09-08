/**
 * Copy assertions every e2e spec reuses (design.md D16; app-shell's "Copy
 * never punishes or gamifies" and identity-realm's "Banner on every
 * screen" / "Demo mode is permanently and unmistakably labeled"). Plain
 * functions over an existing `page`/`locator` — none of these need a
 * fixture of their own (only `demo.ts` extends `test`, per D16).
 */
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Streaks, celebration, damage/restart framing, an invented attention
 * score, or statistics the four-sample protocol cannot support (CLAUDE.md's
 * "No invented attention score" and "Improvement over perfection"
 * invariants; mirrors `apps/web/src/test/copyGuard.ts`'s source-level guard,
 * as a rendered-text check instead).
 */
const PUNITIVE_COPY_PATTERN =
  /streak|confetti|restart the program|damaged|attention \+|attention score|confidence interval|significan/i

/** No punitive/gamified/over-claiming copy is visible anywhere on the page. */
export async function expectNoPunitiveCopy(page: Page): Promise<void> {
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(PUNITIVE_COPY_PATTERN)
}

/**
 * The demonstration-data banner (`DemoBanner.tsx`, `aria-label`
 * "Demonstration data notice") is present, contains both required phrases,
 * and needs no scrolling to see: fully inside the viewport with the page at
 * its top (`scrollY === 0`) — identity-realm's "Banner on every screen"
 * read literally as "without scrolling".
 */
export async function expectDemoBanner(page: Page): Promise<void> {
  const banner = page.getByRole('complementary', { name: 'Demonstration data notice' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/demonstration data/i)
  await expect(banner).toContainText(/not a real measurement/i)
  await expect(banner).toBeInViewport()

  const scrollY = await page.evaluate(() => window.scrollY)
  expect(scrollY).toBe(0)
}

/** A v4 UUID anywhere in a string — the shape every internal id (`sessionId`, `slotId`, `programId`, ...) takes. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * `locator`'s text contains no raw UUID (identity-realm: implementation
 * details — internal ids included — are not user-facing).
 */
export async function expectNoTechnicalIds(locator: Locator): Promise<void> {
  const text = await locator.innerText()
  expect(text).not.toMatch(UUID_PATTERN)
}
