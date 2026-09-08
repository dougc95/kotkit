/**
 * `startBaselineA` — originally task 8.3.4's own export, living in
 * `benchmark-running.spec.ts` itself. Playwright's full-suite discovery
 * rejects a `.spec.ts` file importing another `.spec.ts` file ("test file X
 * should not import test file Y"), which only surfaces once every Group 8
 * spec exists and the suite is run together (each spec file passed
 * individually to the CLI never triggered it) — moved here, alongside
 * `setup.ts`'s `completeSetup`, so `benchmark-running.spec.ts`,
 * `benchmark-review.spec.ts` (8.4.6), `recovery.spec.ts` (8.10.8) and
 * `research-settings.spec.ts` (8.9.4) can all import it without any of them
 * importing another spec file.
 */
import type { Page } from '@playwright/test'

import type { DemoClient } from '../support/demo.js'
import { completeSetup } from './setup.js'

export interface StartBaselineAResult {
  readonly sessionId: string
  readonly slotId: string
}

/**
 * Completes setup, then starts baseline A from Today through the real
 * screens, and resolves once `Running` (8.3.3) has mounted. Assumes the
 * caller already reset demo data (`demo.reset()`) — the same precondition
 * `completeSetup` itself assumes.
 */
export async function startBaselineA(page: Page, demo: DemoClient): Promise<StartBaselineAResult> {
  const { slots } = await completeSetup(page, demo)
  const slotA = slots.find((slot) => slot.phase === 'baseline' && slot.label === 'A')
  if (slotA === undefined) {
    throw new Error('startBaselineA: completeSetup did not return a baseline A slot')
  }

  await page.getByRole('link', { name: 'Start with your baseline' }).click()
  await page.waitForURL(`**/benchmark/${slotA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  // Running replaces Ready in place (no navigation, no URL change) once
  // ['sessions','active'] holds this benchmark — waiting on a Running-only
  // control (Ready has no event buttons at all) is what actually confirms
  // the swap, rather than assuming a fixed delay.
  await page.getByRole('button', { name: 'Record off-task episode' }).waitFor({ state: 'visible' })

  const active = await demo.active()
  if (active === null) {
    throw new Error('startBaselineA: GET /sessions/active returned null after starting baseline A')
  }

  return { sessionId: active.id, slotId: slotA.id }
}
