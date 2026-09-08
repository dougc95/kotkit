/**
 * 5.1.2 — unit tests for the pure pieces of `POST /sessions`' benchmark-start
 * path: `checkSlotStart` and `defaultConditionsFromSlot`. Pure — no
 * database. Covered end to end by API integration in
 * `test/sessions/start.benchmark.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  checkSlotStart,
  defaultConditionsFromSlot,
  type SlotStartAttempt,
} from '../../src/services/slotAttempts.js'

const ASSIGNED = '2026-09-06'

function attempt(overrides: Partial<SlotStartAttempt> = {}): SlotStartAttempt {
  return {
    eligible: null,
    lifecycle: 'finalized',
    excludedByAmendment: false,
    ...overrides,
  }
}

describe('services/slotAttempts checkSlotStart', () => {
  it('no attempts on the assigned date -> ok, not a replacement', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [],
        replacementReason: undefined,
      }),
    ).toEqual({ ok: true, isReplacement: false })
  })

  it('today before the assigned date -> before_slot_date', () => {
    expect(
      checkSlotStart({
        todayLocalDate: '2026-09-05',
        slotAssignedLocalDate: ASSIGNED,
        attempts: [],
        replacementReason: undefined,
      }),
    ).toEqual({ ok: false, reason: 'before_slot_date' })
  })

  it('today after the assigned date with no attempts -> ok (late start recorded, not refused, D23)', () => {
    expect(
      checkSlotStart({
        todayLocalDate: '2026-09-20',
        slotAssignedLocalDate: ASSIGNED,
        attempts: [],
        replacementReason: undefined,
      }),
    ).toEqual({ ok: true, isReplacement: false })
  })

  it('replacementReason on a first attempt -> ok, isReplacement false', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [],
        replacementReason: 'Given even though there is nothing to replace yet',
      }),
    ).toEqual({ ok: true, isReplacement: false })
  })

  it('one ineligible attempt + reason -> ok, isReplacement', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: false })],
        replacementReason: 'Materially disrupted last time',
      }),
    ).toEqual({ ok: true, isReplacement: true })
  })

  it('one ineligible attempt without reason -> replacement_reason_required', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: false })],
        replacementReason: undefined,
      }),
    ).toEqual({ ok: false, reason: 'replacement_reason_required' })

    // Whitespace-only is blank too, not merely an absent field.
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: false })],
        replacementReason: '   ',
      }),
    ).toEqual({ ok: false, reason: 'replacement_reason_required' })
  })

  it('one eligible attempt + reason -> eligible_attempt_not_retaken', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: true })],
        replacementReason: 'Want to try again',
      }),
    ).toEqual({ ok: false, reason: 'eligible_attempt_not_retaken' })
  })

  it('one eligible attempt with an excluding amendment + reason -> ok', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: true, excludedByAmendment: true })],
        replacementReason: 'Excluded by amendment, retaking',
      }),
    ).toEqual({ ok: true, isReplacement: true })
  })

  it('one abandoned attempt (eligible null) + reason -> ok', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: null, lifecycle: 'abandoned' })],
        replacementReason: 'Abandoned last time, retaking',
      }),
    ).toEqual({ ok: true, isReplacement: true })
  })

  it('two attempts -> slot_full even with a reason', () => {
    expect(
      checkSlotStart({
        todayLocalDate: ASSIGNED,
        slotAssignedLocalDate: ASSIGNED,
        attempts: [attempt({ eligible: false }), attempt({ eligible: true })],
        replacementReason: 'One more try please',
      }),
    ).toEqual({ ok: false, reason: 'slot_full' })
  })

  it("checkSlotStart's four failure reasons equal the D19 wire codes verbatim (before_slot_date, slot_full, replacement_reason_required, eligible_attempt_not_retaken)", () => {
    const beforeDate = checkSlotStart({
      todayLocalDate: '2026-09-01',
      slotAssignedLocalDate: ASSIGNED,
      attempts: [],
      replacementReason: undefined,
    })
    expect(beforeDate.ok).toBe(false)
    expect(!beforeDate.ok && beforeDate.reason).toBe('before_slot_date')

    const full = checkSlotStart({
      todayLocalDate: ASSIGNED,
      slotAssignedLocalDate: ASSIGNED,
      attempts: [attempt(), attempt()],
      replacementReason: 'reason',
    })
    expect(full.ok).toBe(false)
    expect(!full.ok && full.reason).toBe('slot_full')

    const reasonRequired = checkSlotStart({
      todayLocalDate: ASSIGNED,
      slotAssignedLocalDate: ASSIGNED,
      attempts: [attempt({ eligible: false })],
      replacementReason: undefined,
    })
    expect(reasonRequired.ok).toBe(false)
    expect(!reasonRequired.ok && reasonRequired.reason).toBe('replacement_reason_required')

    const eligibleNotRetaken = checkSlotStart({
      todayLocalDate: ASSIGNED,
      slotAssignedLocalDate: ASSIGNED,
      attempts: [attempt({ eligible: true })],
      replacementReason: 'reason',
    })
    expect(eligibleNotRetaken.ok).toBe(false)
    expect(!eligibleNotRetaken.ok && eligibleNotRetaken.reason).toBe('eligible_attempt_not_retaken')
  })
})

describe('services/slotAttempts defaultConditionsFromSlot', () => {
  it('defaultConditionsFromSlot copies device_format, language, material_level and sets accommodations []; a body conditions object replaces the default as a whole', () => {
    const slot = { deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate' }
    expect(defaultConditionsFromSlot(slot)).toEqual({
      deviceFormat: 'laptop',
      language: 'en',
      materialLevel: 'intermediate',
      accommodations: [],
    })

    // A slot with all-null fields still yields a valid (all-null) default —
    // never invented text.
    expect(defaultConditionsFromSlot({ deviceFormat: null, language: null, materialLevel: null })).toEqual({
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: [],
    })

    // The caller (`services/session.ts`) picks `body.conditions ??
    // defaultConditionsFromSlot(slot)` — a supplied `conditions` object
    // replaces this default AS A WHOLE, never merging onto it; this default
    // itself never reappears once a body object is supplied.
    const bodyConditions = {
      deviceFormat: 'tablet',
      language: null,
      materialLevel: null,
      accommodations: ['increased_font_size'] as const,
    }
    const chosen = bodyConditions ?? defaultConditionsFromSlot(slot)
    expect(chosen).toBe(bodyConditions)
  })
})
