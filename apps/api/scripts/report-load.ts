/**
 * Task 6.2.5 — report load script (design.md NFR: "report < 1 s at 100k
 * events"; D37: run with `tsx`, no compiled artifact). Seeds one demo
 * program for the fixed `local-demo` principal with a realistic volume of
 * data (4 finalized benchmark attempts, 28 finalized practice sessions and
 * 100 000 `session_events` rows), times 20 real `GET
 * /api/v1/programs/{id}/report` calls through Fastify `inject` on the same
 * `buildTestApp` (3.2.1) every API integration test uses, prints the p95,
 * and always cleans up its own rows via `deletePrincipalData` (3.5.3) —
 * success or failure — so a run never leaves 100k+ rows behind in
 * `attention_lab_test`.
 *
 * This is a load-generation script, not a test file: it runs directly
 * against `DATABASE_URL_TEST` via `npm run load:report`, never through
 * Vitest. It deliberately reuses the same seed helpers (`insertProgram`,
 * `insertSlotSet`, `seedSession`) every 4.x/5.x/6.x integration test builds
 * on (design.md D16: one owner) rather than re-deriving program/session rows
 * by hand.
 */
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import {
  addDays,
  localDateAt,
  localDateForProgramDay,
  type LocalDate,
} from '@attention-lab/shared'

import { buildTestApp } from '../test/helpers/buildTestApp.js'
import { insertProgram, insertSlotSet } from '../test/helpers/programs.js'
import { seedSession } from '../test/helpers/sessions.js'
import { deletePrincipalData } from '../src/db/seed/deletePrincipalData.js'
import { sessionEvents } from '../src/db/schema/index.js'
import { LOCAL_DEMO_PRINCIPAL_ID } from '../src/plugins/identity.js'

const TIMEZONE = 'UTC'
const PRACTICE_TARGET_SECONDS = 600
const PRACTICE_DAYS = 14
const PRACTICE_SESSIONS_PER_DAY = 2 // 14 * 2 = 28 finalized practice sessions
const TOTAL_EVENTS = 100_000
const EVENT_BATCH_SIZE = 5_000
const REPORT_REQUEST_COUNT = 20
const P95_BUDGET_MS = 1000

/** Nearest-rank p95 over `values` (ascending); safe for `noUncheckedIndexedAccess`. */
function p95(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('p95: no samples')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.ceil(0.95 * sorted.length))
  const value = sorted[rank - 1]
  if (value === undefined) {
    throw new Error('p95: rank out of range')
  }
  return value
}

async function main(): Promise<void> {
  const { app, db, close } = await buildTestApp()
  const principalScope = { principalId: LOCAL_DEMO_PRINCIPAL_ID, realm: 'demo' as const }

  try {
    // ---------------------------------------------------------------------
    // Seed one demo program, its four benchmark slots, 4 finalized
    // benchmark attempts and 28 finalized practice sessions across 14 days.
    // ---------------------------------------------------------------------
    const baselineDate: LocalDate = addDays(localDateAt(new Date(), TIMEZONE), -PRACTICE_DAYS)

    const { programId } = await insertProgram(db, {
      baselineDate,
      timezone: TIMEZONE,
      status: 'active',
      practiceTargetSeconds: PRACTICE_TARGET_SECONDS,
    })

    const slots = await insertSlotSet(db, programId)

    const sessionIds: string[] = []

    const benchmarkPlan = [
      { slotId: slots.baselineA, day: 0, hour: 9 },
      { slotId: slots.baselineB, day: 0, hour: 10 },
      { slotId: slots.finalA, day: 14, hour: 9 },
      { slotId: slots.finalB, day: 14, hour: 10 },
    ] as const

    for (const [index, plan] of benchmarkPlan.entries()) {
      const localDate = localDateForProgramDay(baselineDate, plan.day)
      const startedAt = new Date(`${localDate}T${String(plan.hour).padStart(2, '0')}:00:00.000Z`)
      const endedAt = new Date(startedAt.getTime() + 20 * 60_000)
      const { sessionId } = await seedSession(db, {
        programId,
        kind: 'benchmark',
        slotId: plan.slotId,
        lifecycle: 'finalized',
        targetSeconds: 1200,
        startedAt,
        endedAt,
        localDate,
        completeInterval: true,
        eligible: true,
        review: {
          episodeCount: 3 + (index % 2),
          countMethod: 'event',
          firstSwitchKind: 'known',
          firstSwitchSeconds: 240,
          firstSwitchMethod: 'event',
          recallScore: 4,
          finalizedAt: endedAt,
        },
      })
      sessionIds.push(sessionId)
    }

    for (let day = 1; day <= PRACTICE_DAYS; day++) {
      for (let slot = 0; slot < PRACTICE_SESSIONS_PER_DAY; slot++) {
        const localDate = localDateForProgramDay(baselineDate, day)
        const hour = slot === 0 ? 9 : 15
        const startedAt = new Date(`${localDate}T${String(hour).padStart(2, '0')}:00:00.000Z`)
        const endedAt = new Date(startedAt.getTime() + (PRACTICE_TARGET_SECONDS + 60) * 1000)
        const { sessionId } = await seedSession(db, {
          programId,
          kind: 'practice',
          lifecycle: 'finalized',
          targetSeconds: PRACTICE_TARGET_SECONDS,
          startedAt,
          endedAt,
          localDate,
          review: {
            episodeCount: (day + slot) % 5,
            countMethod: 'event',
            outputQuality: 'yes',
            finalizedAt: endedAt,
          },
        })
        sessionIds.push(sessionId)
      }
    }

    // ---------------------------------------------------------------------
    // 100 000 session_events rows, batched 5 000 at a time, spread
    // round-robin across every seeded session.
    // ---------------------------------------------------------------------
    let eventsInserted = 0
    let cursor = 0
    const now = new Date()
    while (eventsInserted < TOTAL_EVENTS) {
      const batchSize = Math.min(EVENT_BATCH_SIZE, TOTAL_EVENTS - eventsInserted)
      const batch = Array.from({ length: batchSize }, () => {
        const sessionId = sessionIds[cursor % sessionIds.length]
        if (sessionId === undefined) {
          throw new Error('report-load: no seeded sessions to attach events to')
        }
        const elapsedMs = (cursor % 1200) * 1000
        cursor += 1
        return {
          sessionId,
          clientEventId: randomUUID(),
          type: 'off_task' as const,
          elapsedMs,
          occurredAt: now,
          receivedAt: now,
          details: {},
          voidedAt: null,
        }
      })
      await db.insert(sessionEvents).values(batch)
      eventsInserted += batchSize
    }

    console.log(
      `report-load: seeded program ${programId} with ${benchmarkPlan.length} benchmark attempts, ` +
        `${sessionIds.length - benchmarkPlan.length} practice sessions and ${eventsInserted} session_events rows`,
    )

    // ---------------------------------------------------------------------
    // 20 real GET /api/v1/programs/{id}/report calls through Fastify inject.
    // ---------------------------------------------------------------------
    const durationsMs: number[] = []
    for (let i = 0; i < REPORT_REQUEST_COUNT; i++) {
      const start = performance.now()
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/programs/${programId}/report`,
      })
      const elapsed = performance.now() - start
      if (res.statusCode !== 200) {
        throw new Error(`report-load: request ${i} returned ${res.statusCode}: ${res.body}`)
      }
      durationsMs.push(elapsed)
    }

    const reportP95 = p95(durationsMs)
    console.log(`report p95 ${reportP95.toFixed(1)} ms`)

    if (reportP95 > P95_BUDGET_MS) {
      process.exitCode = 1
    }
  } finally {
    // Always clean up this principal's rows, whether the run above
    // succeeded, failed the budget, or threw.
    await db.transaction((tx) => deletePrincipalData(tx, principalScope))
    await close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
