/**
 * Accessibility assertions every e2e spec reuses (design.md D16, D14; the
 * non-functional requirements table's "WCAG 2.2 AA on core flow; keyboard-
 * only review; ... reduced motion"). Plain functions over an existing
 * `page` — neither needs a fixture of its own (only `demo.ts` extends
 * `test`, per D16); `expectNoSeriousViolations` reaches the currently
 * running test via `test.info()` only to attach its JSON report, not to
 * gate on anything test-specific.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/** WCAG 2.0 A/AA, 2.1 AA and 2.2 AA — the full set design.md's non-functional table names. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

/** axe's own impact scale; only these two fail the assertion (a `moderate`/`minor` finding is recorded in the attachment but does not fail the spec). */
const FAILING_IMPACTS = new Set(['serious', 'critical'])

/**
 * Runs axe-core against `page` restricted to `WCAG_TAGS`, attaches the full
 * violation list to the test report as `axe-{label}.json` regardless of
 * outcome (so a passing run still leaves a record of any moderate/minor
 * finding), and fails only on a violation whose `impact` is `serious` or
 * `critical`.
 */
export async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()

  await test.info().attach(`axe-${label}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  })

  const serious = results.violations.filter((violation) => FAILING_IMPACTS.has(violation.impact ?? ''))
  expect(serious, `axe found ${serious.length} serious/critical violation(s) on "${label}"`).toEqual([])
}

/**
 * The currently focused element (a) is not `document.body` (i.e. something
 * really is focused), (b) matches `:focus-visible`, and (c) renders a
 * visible indicator — its computed `outline-width` or `box-shadow` differs
 * from what the SAME element computes once blurred. The element is
 * re-focused before returning, so a caller's subsequent keyboard assertions
 * see the same focus state this one found.
 */
export async function expectFocusVisible(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (active === null || active === document.body) {
      return { activeIsBody: true, focusVisible: false, outlineChanged: false, boxShadowChanged: false }
    }

    const focusVisible = active.matches(':focus-visible')
    const focusedStyle = getComputedStyle(active)
    const focusedOutline = focusedStyle.outlineWidth
    const focusedShadow = focusedStyle.boxShadow

    active.blur()
    const blurredStyle = getComputedStyle(active)
    const outlineChanged = focusedOutline !== blurredStyle.outlineWidth
    const boxShadowChanged = focusedShadow !== blurredStyle.boxShadow
    active.focus()

    return { activeIsBody: false, focusVisible, outlineChanged, boxShadowChanged }
  })

  expect(result.activeIsBody, 'document.activeElement must not be <body> — nothing is focused').toBe(false)
  expect(result.focusVisible, 'the focused element must match :focus-visible').toBe(true)
  expect(
    result.outlineChanged || result.boxShadowChanged,
    'the focused element must render a visible indicator (outline-width or box-shadow must differ from its blurred state)',
  ).toBe(true)
}
