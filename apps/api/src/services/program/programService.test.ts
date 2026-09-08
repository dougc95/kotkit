/**
 * 4.1.1 — unit tests for the program service base: `governingRevisionFor`,
 * `initialRevisionSettings`/`INITIAL_REVISION`, the DTO mappers, and
 * `mapPgError`. Pure functions only — no database (see
 * test/helpers/programs.test.ts for the DB-backed helper smoke tests).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BAND_CEILINGS, type Realm, type SlotAttemptValue } from '@attention-lab/shared'

import { ConflictError, DomainError } from '../../errors.js'
import type { RequestContext } from '../../plugins/identity.js'
import {
  INITIAL_REVISION,
  NO_OPEN_PROGRAM_RESULT,
  type ProgramRow,
  type RevisionRow,
  type SlotRow,
  governingRevisionFor,
  guardRealm,
  initialRevisionSettings,
  isOpenStatus,
  mapPgError,
  slotAttemptStates,
  toProgramDto,
  toRevisionDto,
  toSlotDto,
} from './programService.js'

describe('governingRevisionFor', () => {
  const revisions = [
    { revision: 1, effectiveDay: 0 },
    { revision: 2, effectiveDay: 8 },
  ]

  it('(1) returns revision 1 for days -1, 0, 7 and revision 2 (effectiveDay 8) for days 8..14', () => {
    expect(governingRevisionFor(revisions, -1).revision).toBe(1)
    expect(governingRevisionFor(revisions, 0).revision).toBe(1)
    expect(governingRevisionFor(revisions, 7).revision).toBe(1)
    for (const day of [8, 9, 10, 11, 12, 13, 14]) {
      expect(governingRevisionFor(revisions, day).revision).toBe(2)
    }
  })

  it('(2) two revisions with the same effectiveDay: the highest revision number wins', () => {
    const tied = [
      { revision: 1, effectiveDay: 0 },
      { revision: 3, effectiveDay: 5 },
      { revision: 2, effectiveDay: 5 },
    ]
    expect(governingRevisionFor(tied, 5).revision).toBe(3)
    expect(governingRevisionFor(tied, 6).revision).toBe(3)
  })
})

it('(3) initialRevisionSettings(300, 20) carries BAND_CEILINGS (Days 1-3 at 600s) and INITIAL_REVISION reads revision 1 / effectiveDay 0 / initial plan', () => {
  const settings = initialRevisionSettings(300, 20)
  expect(settings.practiceTargetSeconds).toBe(300)
  expect(settings.leisureAllowanceMin).toBe(20)
  expect(settings.bandCeilings).toEqual(DEFAULT_BAND_CEILINGS)
  const days1to3 = settings.bandCeilings.find((band) => band.fromDay === 1 && band.toDay === 3)
  expect(days1to3?.minutes).toBe(10)

  expect(INITIAL_REVISION).toEqual({ revision: 1, effectiveDay: 0, reason: 'initial plan' })
})

function programRow(overrides: Partial<ProgramRow> = {}): ProgramRow {
  return {
    id: 'program-1',
    userId: 'local-demo',
    realm: 'demo',
    baselineDate: '2026-09-06',
    timezone: 'UTC',
    status: 'draft',
    leisureAllowanceMin: 20,
    feedEstimateMin: null,
    currentRevisionId: 'revision-1',
    version: 1,
    ...overrides,
  }
}

it('(4) toProgramDto maps a NULL feed_estimate_min to null, not 0 and not undefined', () => {
  const dto = toProgramDto(programRow({ feedEstimateMin: null }))
  expect(dto.feedEstimateMinutes).toBeNull()

  const zero = toProgramDto(programRow({ feedEstimateMin: 0 }))
  expect(zero.feedEstimateMinutes).toBe(0)
})

it('(5) toProgramDto output carries no userId or user_id key', () => {
  const dto = toProgramDto(programRow()) as Record<string, unknown>
  expect(dto).not.toHaveProperty('userId')
  expect(dto).not.toHaveProperty('user_id')
  expect(Object.keys(dto).sort()).toEqual(
    [
      'baselineDate',
      'currentRevisionId',
      'feedEstimateMinutes',
      'id',
      'leisureAllowanceMinutes',
      'realm',
      'status',
      'timezone',
      'version',
    ].sort(),
  )
})

it('(4b) toProgramDto throws when current_revision_id is NULL', () => {
  expect(() => toProgramDto(programRow({ currentRevisionId: null }))).toThrow()
})

it('toRevisionDto maps settings and createdAt to an ISO string', () => {
  const row: RevisionRow = {
    id: 'revision-1',
    programId: 'program-1',
    revision: 1,
    effectiveDay: 0,
    settings: {
      practiceTargetSeconds: 600,
      bandCeilings: DEFAULT_BAND_CEILINGS,
      leisureAllowanceMin: 20,
    },
    reason: 'initial plan',
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
  }
  const dto = toRevisionDto(row)
  expect(dto.createdAt).toBe('2026-09-06T10:00:00.000Z')
  expect(dto.settings.bandCeilings).toEqual(DEFAULT_BAND_CEILINGS)
})

it('(6) toSlotDto maps plannedLocalTime NULL to null, a set frozenAt to an ISO string, and passes an unfinalized attempt through as eligible: null / excludedByAmendment: false', () => {
  const row: SlotRow = {
    id: 'slot-1',
    programId: 'program-1',
    phase: 'baseline',
    label: 'A',
    materialRef: 'Chapter 3',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: null,
    assignedLocalDate: '2026-09-06',
    frozenAt: new Date('2026-09-06T10:00:00.000Z'),
  }
  const attempts: readonly SlotAttemptValue[] = [
    { sessionId: 'session-1', lifecycle: 'running', eligible: null, excludedByAmendment: false },
  ]

  const dto = toSlotDto(row, attempts)

  expect(dto.plannedLocalTime).toBeNull()
  expect(dto.frozenAt).toBe('2026-09-06T10:00:00.000Z')
  expect(dto.attempts).toEqual([
    { sessionId: 'session-1', lifecycle: 'running', eligible: null, excludedByAmendment: false },
  ])
})

it('toSlotDto maps a NULL frozenAt to null', () => {
  const row: SlotRow = {
    id: 'slot-1',
    programId: 'program-1',
    phase: 'baseline',
    label: 'A',
    materialRef: 'Chapter 3',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: '09:00:00',
    assignedLocalDate: '2026-09-06',
    frozenAt: null,
  }
  const dto = toSlotDto(row, [])
  expect(dto.frozenAt).toBeNull()
  expect(dto.plannedLocalTime).toBe('09:00:00')
  expect(dto.attempts).toEqual([])
})

/** Captures whatever `fn` throws (or `undefined` if it does not throw) without vitest's own message-only `toThrow` matching. */
function captureThrown(fn: () => void): unknown {
  try {
    fn()
    return undefined
  } catch (err) {
    return err
  }
}

function fakePgError(code: string, constraintName?: string): Error & { code: string; constraint_name?: string } {
  const err = new Error(`simulated postgres error ${code}`) as Error & {
    code: string
    constraint_name?: string
  }
  err.code = code
  if (constraintName !== undefined) err.constraint_name = constraintName
  return err
}

it('(7) mapPgError turns 23505 on programs_one_open_per_user into ConflictError code program_exists', () => {
  const err = fakePgError('23505', 'programs_one_open_per_user')
  const thrown = captureThrown(() => mapPgError(err))
  expect(thrown).toBeInstanceOf(ConflictError)
  expect((thrown as ConflictError).code).toBe('program_exists')
  expect((thrown as ConflictError).status).toBe(409)
})

it('(8) 23505 on any other constraint is rethrown unchanged', () => {
  const err = fakePgError('23505', 'some_other_constraint')
  expect(captureThrown(() => mapPgError(err))).toBe(err)
})

it('(9) a non-23505 error is rethrown unchanged', () => {
  const err = new Error('totally unrelated failure')
  expect(captureThrown(() => mapPgError(err))).toBe(err)
})

it('(9b) a plain (non-Postgres, non-Error) thrown value is rethrown unchanged', () => {
  const err = { some: 'value' }
  expect(captureThrown(() => mapPgError(err))).toBe(err)
})

// ---------------------------------------------------------------------------
// task 4.2.3
// ---------------------------------------------------------------------------

it('(1) the empty snapshot for no program (NO_OPEN_PROGRAM_RESULT) yields nextAction setup, day: null (not 0), revision: null, slots: []', () => {
  expect(NO_OPEN_PROGRAM_RESULT).toEqual({
    program: null,
    revision: null,
    slots: [],
    day: null,
    nextAction: { kind: 'setup' },
  })
  expect(NO_OPEN_PROGRAM_RESULT.day).toBeNull()
  expect(NO_OPEN_PROGRAM_RESULT.day).not.toBe(0)
})

describe('slotAttemptStates (task 4.2.3)', () => {
  it('(2a) a slot with a finalized row -> hasFinalizedAttempt true', () => {
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'session-1', lifecycle: 'finalized', eligible: true, excludedByAmendment: false },
    ]
    expect(slotAttemptStates(attempts)).toEqual({ hasFinalizedAttempt: true, attempts })
  })

  it("(2b) only an abandoned row -> false with attempts [{ lifecycle 'abandoned', eligible null, excludedByAmendment false }]", () => {
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'session-1', lifecycle: 'abandoned', eligible: null, excludedByAmendment: false },
    ]
    expect(slotAttemptStates(attempts)).toEqual({
      hasFinalizedAttempt: false,
      attempts: [{ sessionId: 'session-1', lifecycle: 'abandoned', eligible: null, excludedByAmendment: false }],
    })
  })

  it('(2c) no rows -> false with attempts []', () => {
    expect(slotAttemptStates([])).toEqual({ hasFinalizedAttempt: false, attempts: [] })
  })
})

describe('guardRealm (task 4.2.3)', () => {
  const demoCtx = { realm: 'demo' as Realm } as RequestContext

  it('(3a) throws DomainError realm_mismatch on one foreign row among demo rows', () => {
    const rows: readonly { realm: Realm }[] = [{ realm: 'demo' }, { realm: 'demo' }, { realm: 'pilot' }]
    const thrown = captureThrown(() => guardRealm(demoCtx, rows))
    expect(thrown).toBeInstanceOf(DomainError)
    expect((thrown as DomainError).code).toBe('realm_mismatch')
    expect((thrown as DomainError).status).toBe(422)
  })

  it('(3b) passes on an empty list', () => {
    expect(() => guardRealm(demoCtx, [])).not.toThrow()
  })

  it('(3c) passes when every row matches the context realm', () => {
    expect(() => guardRealm(demoCtx, [{ realm: 'demo' }, { realm: 'demo' }])).not.toThrow()
  })
})

describe('isOpenStatus (task 4.1.3)', () => {
  it("(1) true for 'draft', 'baseline_ready', 'active'", () => {
    expect(isOpenStatus('draft')).toBe(true)
    expect(isOpenStatus('baseline_ready')).toBe(true)
    expect(isOpenStatus('active')).toBe(true)
  })

  it("(2) false for 'completed', 'archived'", () => {
    expect(isOpenStatus('completed')).toBe(false)
    expect(isOpenStatus('archived')).toBe(false)
  })
})
