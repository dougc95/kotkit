import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  RECALL_DELAY_FLAG_SECONDS,
  RECALL_OVERRUN_FLAG_SECONDS,
  RECALL_POINT_COUNT,
  RECALL_WINDOW_SECONDS,
  deriveRecallFlags,
  isBlankPoint,
  recallDelaySeconds,
  scoreRecall,
  type RecallPointScores,
  type RecallPoints,
} from '../../src/domain/recall.js'
import { RECALL_FLAGS, type ExclusionReason, type RecallFlag } from '../../src/domain/types.js'

describe('domain/recall: deriveRecallFlags thresholds', () => {
  it('delay 40 → no flags', () => {
    expect(deriveRecallFlags({ delaySeconds: 40, durationSeconds: 0 })).toEqual([])
  })

  it('delay 600 → no flags (boundary is strict)', () => {
    expect(deriveRecallFlags({ delaySeconds: 600, durationSeconds: 0 })).toEqual([])
  })

  it('delay 601 → [recall_delayed]', () => {
    expect(deriveRecallFlags({ delaySeconds: 601, durationSeconds: 0 })).toEqual(['recall_delayed'])
  })

  it('duration 210 → no flags; 211 → [recall_overrun]', () => {
    expect(deriveRecallFlags({ delaySeconds: 0, durationSeconds: 210 })).toEqual([])
    expect(deriveRecallFlags({ delaySeconds: 0, durationSeconds: 211 })).toEqual(['recall_overrun'])
  })

  it('delay 1500 (long break) with duration 230 → both flags', () => {
    expect(deriveRecallFlags({ delaySeconds: 1500, durationSeconds: 230 })).toEqual([
      'recall_delayed',
      'recall_overrun',
    ])
  })
})

describe('domain/recall: recallDelaySeconds', () => {
  it('floors 40.9 s to 40 and throws when recall starts before the interval ended', () => {
    const intervalEndedAt = new Date('2026-09-06T12:00:00.000Z')
    const recallStartedAt = new Date(intervalEndedAt.getTime() + 40_900)
    expect(recallDelaySeconds(intervalEndedAt, recallStartedAt)).toBe(40)

    const before = new Date(intervalEndedAt.getTime() - 1_000)
    expect(() => recallDelaySeconds(intervalEndedAt, before)).toThrow()
  })
})

describe('domain/recall: isBlankPoint', () => {
  it('"" and "   " are blank; "x" is not', () => {
    expect(isBlankPoint('')).toBe(true)
    expect(isBlankPoint('   ')).toBe(true)
    expect(isBlankPoint('x')).toBe(false)
  })
})

describe('domain/recall: scoreRecall', () => {
  it('points 1–3 accurate, 4–5 blank → recallScore 3, recallScores [1,1,1,0,0], complete true', () => {
    const points: RecallPoints = ['point one', 'point two', 'point three', '', '   ']
    const scores: RecallPointScores = [1, 1, 1, null, null]
    expect(scoreRecall(points, scores)).toEqual({
      recallScores: [1, 1, 1, 0, 0],
      recallScore: 3,
      complete: true,
    })
  })

  it('blank point given score 1 is forced to 0', () => {
    const points: RecallPoints = ['', 'b', 'c', 'd', 'e']
    const scores: RecallPointScores = [1, 1, 1, 1, 1]
    const result = scoreRecall(points, scores)
    expect(result.recallScores?.[0]).toBe(0)
    expect(result.recallScore).toBe(4)
    expect(result.complete).toBe(true)
  })

  it('non-blank point with null score → recallScore null, recallScores null, complete false (never a partial array)', () => {
    const points: RecallPoints = ['a', 'b', 'c', 'd', 'e']
    const scores: RecallPointScores = [1, 1, 1, 1, null]
    expect(scoreRecall(points, scores)).toEqual({
      recallScores: null,
      recallScore: null,
      complete: false,
    })
  })

  it('scores null with a non-blank point → null, incomplete', () => {
    const points: RecallPoints = ['a', 'b', 'c', 'd', 'e']
    const result = scoreRecall(points, null)
    expect(result.recallScores).toBeNull()
    expect(result.recallScore).toBeNull()
    expect(result.complete).toBe(false)
  })

  it('all five blank with scores null → recallScore 0, complete true (a measurement, not null)', () => {
    const points: RecallPoints = ['', ' ', '  ', '', '\t']
    const result = scoreRecall(points, null)
    expect(result).toEqual({
      recallScores: [0, 0, 0, 0, 0],
      recallScore: 0,
      complete: true,
    })
  })

  it('all five accurate → 5', () => {
    const points: RecallPoints = ['a', 'b', 'c', 'd', 'e']
    const scores: RecallPointScores = [1, 1, 1, 1, 1]
    const result = scoreRecall(points, scores)
    expect(result.recallScore).toBe(5)
    expect(result.recallScores).toEqual([1, 1, 1, 1, 1])
    expect(result.complete).toBe(true)
  })
})

describe('domain/recall: constants and flag typing', () => {
  it('constants are 600, 210, 5 and 180', () => {
    expect(RECALL_DELAY_FLAG_SECONDS).toBe(600)
    expect(RECALL_OVERRUN_FLAG_SECONDS).toBe(210)
    expect(RECALL_POINT_COUNT).toBe(5)
    expect(RECALL_WINDOW_SECONDS).toBe(180)
  })

  it('RecallFlag is not assignable to ExclusionReason, and deriveRecallFlags returns only RECALL_FLAGS members', () => {
    expectTypeOf<RecallFlag>().not.toMatchTypeOf<ExclusionReason>()
    const flags = deriveRecallFlags({ delaySeconds: 1500, durationSeconds: 230 })
    for (const flag of flags) {
      expect(RECALL_FLAGS).toContain(flag)
    }
  })
})
