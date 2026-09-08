/**
 * Task 6.2.2 — PRD §6 acceptance suite for `GET /api/v1/programs/{id}/report`:
 * every named demo scenario (`DEMO_SCENARIO_NAMES`) is loaded for real
 * against `attention_lab_test` via `POST /demo/scenarios/{name}/load`
 * (`new-user` instead creates an empty program through the real
 * `POST /programs` route, per D22's `{ programId: null }`) and its report is
 * checked against `resolveResultState`'s D7.4 precedence table and the PRD
 * §5 copy in `RESULT_STATE_COPY`/`CAUSE_NOTE`. Four additional result-state
 * row sets with no scenario fixture of their own (`more_switches`,
 * `unchanged`, a low-baseline shape and a "zero beats direction" shape) are
 * derived from the loaded `comparable-change` scenario by
 * `helpers/reportVariants.ts`'s `applyReportVariant`.
 *
 * See design.md's task-detail 6.2.2, D7.4 and `domain/comparison.ts`.
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CAUSE_NOTE,
  DEMO_SCENARIOS,
  DEMO_SCENARIO_NAMES,
  RESULT_STATE_COPY,
  type DemoScenarioName,
  type ReportResponseValue,
} from '@attention-lab/shared'

import type { AppDatabase } from '../src/plugins/db.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { createProgramViaApi } from './helpers/programs.js'
import { applyReportVariant } from './helpers/reportVariants.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** `POST /demo/scenarios/{name}/load` — returns the new program id, or `null` for `new-user` (D22). */
async function loadScenario(app: FastifyInstance, name: DemoScenarioName): Promise<string | null> {
  const res = await app.inject({ method: 'POST', url: `/api/v1/demo/scenarios/${name}/load` })
  expect(res.statusCode).toBe(200)
  return (res.json() as { programId: string | null }).programId
}

async function getReport(app: FastifyInstance, programId: string): Promise<ReportResponseValue> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/report` })
  expect(res.statusCode).toBe(200)
  return res.json() as ReportResponseValue
}

/**
 * Loads one named scenario and returns its report. `new-user` has no
 * program to load a report for (`loadScenario` returns `null`) — this task's
 * own brief creates an empty program via the real `POST /programs` (4.1.2)
 * instead, matching how a freshly-set-up account actually reaches
 * `baseline_pending`.
 */
async function scenarioReport(app: FastifyInstance, name: DemoScenarioName): Promise<ReportResponseValue> {
  if (name === 'new-user') {
    const created = await createProgramViaApi(app)
    expect(created.statusCode).toBe(201)
    return getReport(app, created.body.program.id)
  }
  const programId = await loadScenario(app, name)
  if (programId === null) {
    throw new Error(`scenarioReport: scenario "${name}" unexpectedly returned no program`)
  }
  return getReport(app, programId)
}

/** `comparable-change`, loaded fresh, with one of the four derived variants applied — see `applyReportVariant`. */
async function variantReport(
  app: FastifyInstance,
  db: AppDatabase,
  variant: Parameters<typeof applyReportVariant>[2],
): Promise<ReportResponseValue> {
  const programId = await loadScenario(app, 'comparable-change')
  if (programId === null) {
    throw new Error('variantReport: "comparable-change" unexpectedly returned no program')
  }
  await applyReportVariant(db, programId, variant)
  return getReport(app, programId)
}

/**
 * Recursively walks a serialized report (or any JSON-shaped value) and
 * records every violation of `progress-report`'s "No invented scores": an
 * object key matching `/score|confidence|significance|pValue/i` other than
 * the one legitimate `recallScore` field, or a string value matching
 * `/attention\s*\+/i` (an invented "attention +N%" claim).
 */
function collectInventedScoreViolations(value: unknown, path: string, violations: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInventedScoreViolations(item, `${path}[${index}]`, violations))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/score|confidence|significance|pvalue/i.test(key) && key !== 'recallScore') {
        violations.push(`${path}.${key} (disallowed key)`)
      }
      collectInventedScoreViolations(child, `${path}.${key}`, violations)
    }
    return
  }
  if (typeof value === 'string' && /attention\s*\+/i.test(value)) {
    violations.push(`${path} (text: ${JSON.stringify(value)})`)
  }
}

describe('GET /api/v1/programs/{id}/report — PRD §6 scenario acceptance (integration, attention_lab_test)', () => {
  let testApp: TestApp
  let app: FastifyInstance
  let db: AppDatabase

  beforeAll(async () => {
    testApp = await buildTestApp()
    app = testApp.app
    db = testApp.db
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  it('new user → baseline_pending, samples { baselineEligible 0, finalEligible 0 }, attempts [], comparison absent', async () => {
    const body = await scenarioReport(app, 'new-user')
    expect(body.resultState).toBe('baseline_pending')
    expect(body.samples).toEqual({ baselineEligible: 0, finalEligible: 0 })
    expect(body.attempts).toEqual([])
    expect(body.comparison).toBeUndefined()
  })

  it('working day (Day 4, D35) → final_pending with two eligible baselines and comparison absent', async () => {
    const body = await scenarioReport(app, 'working-day')
    expect(body.resultState).toBe('final_pending')
    expect(body.samples.baselineEligible).toBe(2)
    expect(body.comparison).toBeUndefined()
  })

  it('comparable change → improvement_maintained_recall; s0 5, s14 3, absoluteChange 2, percentageReduction 40, recall means 4 → 4; headline matches /fewer switches/ and /reported/ and CAUSE_NOTE is present', async () => {
    const body = await scenarioReport(app, 'comparable-change')
    expect(body.resultState).toBe('improvement_maintained_recall')
    expect(body.comparison).toBeDefined()
    expect(body.comparison?.s0).toBe(5)
    expect(body.comparison?.s14).toBe(3)
    expect(body.comparison?.absoluteChange).toBe(2)
    expect(body.comparison?.percentageReduction).toBe(40)
    expect(body.comparison?.recallBaselineMean).toBe(4)
    expect(body.comparison?.recallFinalMean).toBe(4)

    const copy = RESULT_STATE_COPY[body.resultState]
    const copyText = `${copy.headline ?? ''} ${copy.message}`
    expect(copyText).toMatch(/fewer switches/i)
    expect(copyText).toMatch(/reported/i)
    expect(CAUSE_NOTE.length).toBeGreaterThan(0)
  })

  it("mixed result → fewer_switches_lower_recall; recall 4 → 2; headline 'Switches decreased, but recall was lower. These results are mixed.'", async () => {
    const body = await scenarioReport(app, 'mixed-result')
    expect(body.resultState).toBe('fewer_switches_lower_recall')
    expect(body.comparison?.recallBaselineMean).toBe(4)
    expect(body.comparison?.recallFinalMean).toBe(2)
    expect(RESULT_STATE_COPY[body.resultState].message).toBe(
      'Switches decreased, but recall was lower. These results are mixed.',
    )
  })

  it('missing final → insufficient_samples, no percentage, eligible attempts listed', async () => {
    const body = await scenarioReport(app, 'missing-final')
    expect(body.resultState).toBe('insufficient_samples')
    expect(body.comparison).toBeUndefined()
    expect(body.attempts).toHaveLength(4)
    const eligibleAttempts = body.attempts.filter((attempt) => attempt.eligible)
    expect(eligibleAttempts).toHaveLength(3)
  })

  it("zero baseline → zero_baseline; percentageReduction null; absolute counts present; JSON contains no 'Infinity', 'NaN' or '100'", async () => {
    const body = await scenarioReport(app, 'zero-baseline')
    expect(body.resultState).toBe('zero_baseline')
    expect(body.comparison).toBeDefined()
    expect(body.comparison?.percentageReduction).toBeNull()
    expect(body.comparison?.s0).toBe(0)
    expect(body.comparison?.s14).toBe(0)
    expect(body.comparison?.absoluteChange).toBe(0)

    // Scoped to `comparison` (never `body` as a whole): attempt/revision ids
    // are random UUIDs and, being hex, could coincidentally contain "100" —
    // the invariant this guards ("no invented 100% / NaN / Infinity out of a
    // zero baseline") lives entirely in the comparison numbers, which carry
    // no ids at all.
    const serializedComparison = JSON.stringify(body.comparison)
    expect(serializedComparison).not.toContain('Infinity')
    expect(serializedComparison).not.toContain('NaN')
    expect(serializedComparison).not.toContain('100')
  })

  it('recovery → final_pending, two eligible baselines, attempts contain no practice session', async () => {
    const body = await scenarioReport(app, 'recovery')
    expect(body.resultState).toBe('final_pending')
    expect(body.samples.baselineEligible).toBe(2)
    // The report's attempts[] loader only ever selects kind='benchmark'
    // sessions (6.2.1's `loadAttemptSummaries`) — the scenario's one running
    // practice session structurally cannot appear here; this fixture has
    // exactly the two baseline benchmark attempts and nothing else.
    expect(body.attempts).toHaveLength(2)
    expect(body.attempts.every((attempt) => attempt.phase === 'baseline')).toBe(true)
  })

  it("timing deviation → baseline_pending; attempts lists baseline A with lifecycle 'running', eligible false, exclusionReasons []; zero finalized attempts; samples.baselineEligible 0", async () => {
    const body = await scenarioReport(app, 'timing-deviation')
    expect(body.resultState).toBe('baseline_pending')
    const baselineA = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'A')
    expect(baselineA?.lifecycle).toBe('running')
    expect(baselineA?.eligible).toBe(false)
    expect(baselineA?.exclusionReasons).toEqual([])
    expect(body.attempts.some((attempt) => attempt.lifecycle === 'finalized')).toBe(false)
    expect(body.samples.baselineEligible).toBe(0)
  })

  it("more switches (3 → 5) → more_switches with headline 'More switches were reported in the final sessions.'", async () => {
    const body = await variantReport(app, db, 'more-switches')
    expect(body.resultState).toBe('more_switches')
    expect(RESULT_STATE_COPY[body.resultState].message).toBe(
      'More switches were reported in the final sessions.',
    )
  })

  it("unchanged (3 → 3) → unchanged with headline 'The reported switch count did not change.'", async () => {
    const body = await variantReport(app, db, 'unchanged')
    expect(body.resultState).toBe('unchanged')
    expect(RESULT_STATE_COPY[body.resultState].message).toBe('The reported switch count did not change.')
  })

  it('low baseline (2 → 1) → absoluteChange 1 and comparison.lowBaseline true', async () => {
    const body = await variantReport(app, db, 'low-baseline')
    expect(body.comparison?.absoluteChange).toBe(1)
    expect(body.comparison?.lowBaseline).toBe(true)
  })

  it('zero beats direction (0 → 1) → zero_baseline, not more_switches', async () => {
    const body = await variantReport(app, db, 'zero-beats-direction')
    expect(body.resultState).toBe('zero_baseline')
    expect(body.resultState).not.toBe('more_switches')
  })

  it('no invented score keys or "attention +" text in any scenario', async () => {
    const violations: string[] = []

    for (const name of DEMO_SCENARIO_NAMES) {
      const body = await scenarioReport(app, name)
      collectInventedScoreViolations(body, name, violations)
    }

    for (const variant of ['more-switches', 'unchanged', 'low-baseline', 'zero-beats-direction'] as const) {
      const body = await variantReport(app, db, variant)
      collectInventedScoreViolations(body, `variant:${variant}`, violations)
    }

    expect(violations).toEqual([])
  })

  it("realm is 'demo' in every scenario report and resultState equals the fixture's expected.resultState wherever it is non-null", async () => {
    for (const name of DEMO_SCENARIO_NAMES) {
      const body = await scenarioReport(app, name)
      expect(body.realm).toBe('demo')

      const expectedResultState = DEMO_SCENARIOS[name].expected.resultState
      if (expectedResultState !== null) {
        expect(body.resultState).toBe(expectedResultState)
      }
    }
  })
})
