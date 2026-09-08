/**
 * 4.1.2 — unit tests for the pure builders `createProgram` (POST /programs)
 * assembles its transaction from: `buildProgramInsert` and
 * `buildInitialRevisionInsert`. No database — see
 * `test/programs/create.test.ts` for the Fastify-inject integration tests
 * against `attention_lab_test`.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BAND_CEILINGS, type CreateProgramBodyValue } from '@attention-lab/shared'

import { buildInitialRevisionInsert, buildProgramInsert } from './programService.js'

const BASE_BODY: CreateProgramBodyValue = {
  baselineDate: '2026-09-06',
  timezone: 'Europe/Madrid',
  practiceTargetSeconds: 600,
}

const CTX = { principalId: 'local-demo', realm: 'demo' } as const

describe('buildProgramInsert', () => {
  it('(1) leisureAllowanceMinutes omitted -> 20, feedEstimateMinutes omitted -> null (not 0, not undefined), status draft, version 1', () => {
    const row = buildProgramInsert(CTX, BASE_BODY, 'program-1')

    expect(row.leisureAllowanceMin).toBe(20)
    expect(row.feedEstimateMin).toBeNull()
    expect(row.feedEstimateMin).not.toBe(0)
    expect(row.feedEstimateMin).not.toBeUndefined()
    expect(row.status).toBe('draft')
    expect(row.version).toBe(1)
    expect(row.id).toBe('program-1')
    expect(row.baselineDate).toBe('2026-09-06')
    expect(row.timezone).toBe('Europe/Madrid')
  })

  it('(2) user_id and realm come from ctx even when the body object carries realm and userId', () => {
    const bodyWithForeignKeys = {
      ...BASE_BODY,
      realm: 'pilot',
      userId: 'someone-else',
    } as unknown as CreateProgramBodyValue

    const row = buildProgramInsert(CTX, bodyWithForeignKeys, 'program-1')

    expect(row.userId).toBe('local-demo')
    expect(row.realm).toBe('demo')
  })

  it('(3) feedEstimateMinutes 0 survives as 0, distinct from null', () => {
    const row = buildProgramInsert(CTX, { ...BASE_BODY, feedEstimateMinutes: 0 }, 'program-1')
    expect(row.feedEstimateMin).toBe(0)
    expect(row.feedEstimateMin).not.toBeNull()
  })
})

describe('buildInitialRevisionInsert', () => {
  it('(4) revision row reads { revision: 1, effectiveDay: 0, reason: "initial plan" } with settings.practiceTargetSeconds from the body and settings.bandCeilings equal to BAND_CEILINGS', () => {
    const row = buildInitialRevisionInsert('program-1', BASE_BODY, 20)

    expect(row.programId).toBe('program-1')
    expect(row.revision).toBe(1)
    expect(row.effectiveDay).toBe(0)
    expect(row.reason).toBe('initial plan')
    expect(row.settings.practiceTargetSeconds).toBe(BASE_BODY.practiceTargetSeconds)
    expect(row.settings.bandCeilings).toEqual(DEFAULT_BAND_CEILINGS)
    expect(row.settings.leisureAllowanceMin).toBe(20)
  })
})
