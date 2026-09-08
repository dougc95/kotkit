/**
 * 4.3.1 — unit tests for `assignedDateFor` and `normalizeSlotSet`, the pure
 * readiness validator for a program's benchmark slot set. Pure — no
 * database. Covered by API integration in 4.3.2 (this task has no
 * integration suite of its own).
 */
import { describe, expect, it } from 'vitest'

import { DomainError, MalformedError } from '../../errors.js'
import {
  assignedDateFor,
  frozenFieldsUnchanged,
  isFrozen,
  normalizeSlotSet,
  type FrozenComparableFields,
  type SlotInput,
} from './readiness.js'

const BASELINE_DATE = '2026-09-06'

function slot(overrides: Partial<SlotInput> & Pick<SlotInput, 'phase' | 'label'>): SlotInput {
  return { materialRef: 'Chapter 1', ...overrides }
}

describe('normalizeSlotSet', () => {
  it('(1) 09:00 and 09:59 -> baseline_times_too_close with message containing "one hour"', () => {
    try {
      normalizeSlotSet(
        [
          slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
          slot({ phase: 'baseline', label: 'B', plannedLocalTime: '09:59' }),
        ],
        { baselineDate: BASELINE_DATE },
      )
      expect.unreachable('expected normalizeSlotSet to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('baseline_times_too_close')
      expect((err as DomainError).message.toLowerCase()).toContain('one hour')
    }
  })

  it('(2) 09:00 and 10:00 -> ok', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.slots).toHaveLength(2)
  })

  it('(3) B at 08:00 before A at 12:00 -> ok', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '12:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '08:00' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.slots).toHaveLength(2)
  })

  it('(4) 23:30 and 00:15 -> ok (same-date semantics)', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '23:30' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '00:15' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.slots).toHaveLength(2)
  })

  it('(5) finals without times inherit baseline A/B times respectively', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    const finalA = result.slots.find((s) => s.phase === 'final' && s.label === 'A')
    const finalB = result.slots.find((s) => s.phase === 'final' && s.label === 'B')
    expect(finalA?.plannedLocalTime).toBe('09:00')
    expect(finalB?.plannedLocalTime).toBe('10:00')
  })

  it('(6) final with explicit time keeps it', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'final', label: 'A', plannedLocalTime: '14:00' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    const finalA = result.slots.find((s) => s.phase === 'final' && s.label === 'A')
    expect(finalA?.plannedLocalTime).toBe('14:00')
  })

  it('(7) three references -> missing exactly [{final, B, [materialRef]}]', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.missing).toEqual([{ phase: 'final', label: 'B', fields: ['materialRef'] }])
    expect(result.complete).toBe(false)
  })

  it('(8) whitespace materialRef -> missing materialRef', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', materialRef: '   ', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.missing).toEqual([{ phase: 'baseline', label: 'A', fields: ['materialRef'] }])
  })

  it('(9) baseline A without time -> missing [plannedLocalTime]', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.missing).toEqual([{ phase: 'baseline', label: 'A', fields: ['plannedLocalTime'] }])
  })

  it('(10) baseline A without ref and time -> both fields listed', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', materialRef: '   ' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.missing).toEqual([
      { phase: 'baseline', label: 'A', fields: ['materialRef', 'plannedLocalTime'] },
    ])
  })

  it('(11) midpoint absent -> not in missing, complete true when four present', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    expect(result.missing).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.slots.some((s) => s.phase === 'midpoint')).toBe(false)
  })

  it('(12) midpoint present -> assigned Day 7 date', () => {
    const result = normalizeSlotSet(
      [
        slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
        slot({ phase: 'baseline', label: 'B', plannedLocalTime: '10:00' }),
        slot({ phase: 'midpoint', label: 'A' }),
        slot({ phase: 'final', label: 'A' }),
        slot({ phase: 'final', label: 'B' }),
      ],
      { baselineDate: BASELINE_DATE },
    )
    const midpoint = result.slots.find((s) => s.phase === 'midpoint')
    expect(midpoint?.assignedLocalDate).toBe('2026-09-13')
    expect(midpoint && result.missing.some((m) => m.phase === 'midpoint')).toBeFalsy()
  })

  it("(13) duplicate (baseline, A) -> MalformedError with fieldErrors key 'slots[1]'", () => {
    try {
      normalizeSlotSet(
        [
          slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:00' }),
          slot({ phase: 'baseline', label: 'A', plannedLocalTime: '09:30' }),
        ],
        { baselineDate: BASELINE_DATE },
      )
      expect.unreachable('expected normalizeSlotSet to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).fieldErrors).toEqual({ 'slots[1]': 'duplicate slot' })
    }
  })
})

describe('assignedDateFor', () => {
  it('(14) Day 0 = baselineDate, Day 14 = baselineDate + 14 local days across a DST boundary (2026-10-28 -> 2026-11-11)', () => {
    expect(assignedDateFor('baseline', '2026-09-06')).toBe('2026-09-06')
    expect(assignedDateFor('final', '2026-10-28')).toBe('2026-11-11')
  })
})

// ---------------------------------------------------------------------------
// task 4.3.2 — frozenFieldsUnchanged / isFrozen
// ---------------------------------------------------------------------------

const FROZEN_FIELDS: FrozenComparableFields = {
  materialRef: 'Chapter 3',
  plannedLocalTime: '09:00',
  language: 'en',
  deviceFormat: 'print',
  materialLevel: 'intermediate',
}

describe('frozenFieldsUnchanged', () => {
  it('(1) identical -> true', () => {
    expect(frozenFieldsUnchanged(FROZEN_FIELDS, { ...FROZEN_FIELDS })).toBe(true)
  })

  it('(2) materialRef changed -> false', () => {
    expect(frozenFieldsUnchanged(FROZEN_FIELDS, { ...FROZEN_FIELDS, materialRef: 'Chapter 4' })).toBe(
      false,
    )
  })

  it('(3) plannedLocalTime changed -> false', () => {
    expect(
      frozenFieldsUnchanged(FROZEN_FIELDS, { ...FROZEN_FIELDS, plannedLocalTime: '09:30' }),
    ).toBe(false)
  })

  it('(4) language null vs undefined -> true', () => {
    expect(
      frozenFieldsUnchanged(
        { ...FROZEN_FIELDS, language: null },
        { ...FROZEN_FIELDS, language: undefined },
      ),
    ).toBe(true)
  })
})

describe('isFrozen', () => {
  it('(5) isFrozen({ frozen_at: null }, attemptCount 1) -> true', () => {
    expect(isFrozen({ frozenAt: null }, 1)).toBe(true)
  })

  it('(6) isFrozen({ frozen_at: date }, 0) -> true', () => {
    expect(isFrozen({ frozenAt: new Date('2026-09-06T10:00:00.000Z') }, 0)).toBe(true)
  })

  it('(7) isFrozen({ frozen_at: null }, 0) -> false', () => {
    expect(isFrozen({ frozenAt: null }, 0)).toBe(false)
  })
})
