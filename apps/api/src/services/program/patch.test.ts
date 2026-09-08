/**
 * 4.4.2 — unit tests for the pure helpers behind `PATCH /programs/{id}`:
 * `canTransition`, `dateEditAllowed`, `recomputeAssignedDates`. Pure — no
 * database; the route's transactional behavior (`patchProgram`) is covered
 * by `test/programs/patch.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { canTransition, dateEditAllowed, recomputeAssignedDates } from './patch.js'

describe('canTransition', () => {
  it('(1) allowed: baseline_ready->completed, active->completed, draft->archived, baseline_ready->archived, active->archived; disallowed: draft->completed, completed->archived, archived->completed, active->active, baseline_ready->active', () => {
    expect(canTransition('baseline_ready', 'completed')).toBe(true)
    expect(canTransition('active', 'completed')).toBe(true)
    expect(canTransition('draft', 'archived')).toBe(true)
    expect(canTransition('baseline_ready', 'archived')).toBe(true)
    expect(canTransition('active', 'archived')).toBe(true)

    expect(canTransition('draft', 'completed')).toBe(false)
    expect(canTransition('completed', 'archived')).toBe(false)
    expect(canTransition('archived', 'completed')).toBe(false)
    expect(canTransition('active', 'active')).toBe(false)
    expect(canTransition('baseline_ready', 'active')).toBe(false)
  })
})

describe('dateEditAllowed', () => {
  it('(2) true for draft, false for baseline_ready and active', () => {
    expect(dateEditAllowed('draft')).toBe(true)
    expect(dateEditAllowed('baseline_ready')).toBe(false)
    expect(dateEditAllowed('active')).toBe(false)
  })
})

describe('recomputeAssignedDates', () => {
  it('(3) maps baseline slots to the new Day 0, midpoint to Day 7 and finals to the new Day 14', () => {
    const slots = [
      { id: 'baseline-a', phase: 'baseline' as const },
      { id: 'midpoint-a', phase: 'midpoint' as const },
      { id: 'final-a', phase: 'final' as const },
    ]

    const result = recomputeAssignedDates(slots, '2026-09-09')

    expect(result).toEqual([
      { id: 'baseline-a', assignedLocalDate: '2026-09-09' },
      { id: 'midpoint-a', assignedLocalDate: '2026-09-16' },
      { id: 'final-a', assignedLocalDate: '2026-09-23' },
    ])
  })
})
