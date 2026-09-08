/**
 * 5.3.1 — unit tests for the pure pieces of `POST /sessions/{id}/events`:
 * `partitionBatch`, `findImpossibleOffsets`, `withReconciliationWarning`, the
 * clock_gap `details` round trip (`buildEventInsertRow`), and the
 * repository-guard static check that only `services/session.ts` ever inserts
 * into `session_events`. Pure — no database. Covered end to end by API
 * integration in `test/sessions/events.test.ts`.
 *
 * 5.3.2 appends `canVoid` and `isVoidableType`, the two pure gates behind
 * `POST /sessions/{id}/events/{clientEventId}/void`. Covered end to end by
 * API integration in `test/sessions/void.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildEventInsertRow,
  canVoid,
  EVENT_OFFSET_TOLERANCE_MS,
  findImpossibleOffsets,
  isVoidableType,
  partitionBatch,
  withReconciliationWarning,
} from '../../src/services/sessionEvents.js'
import type { EventInputValue } from '@attention-lab/shared'

const UUID_1 = '123e4567-e89b-12d3-a456-426614174000'
const UUID_2 = '223e4567-e89b-12d3-a456-426614174000'
const UUID_3 = '323e4567-e89b-12d3-a456-426614174000'
const SESSION_ID = '423e4567-e89b-12d3-a456-426614174000'

function offTaskEvent(clientEventId: string, elapsedMs = 0): EventInputValue {
  return { clientEventId, type: 'off_task', elapsedMs, occurredAt: '2026-09-10T09:00:00.000Z' }
}

describe('services/sessionEvents partitionBatch', () => {
  it('a clientEventId repeated within the batch puts the second copy in duplicates', () => {
    const result = partitionBatch([offTaskEvent(UUID_1, 1000), offTaskEvent(UUID_1, 2000)], new Set())
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]?.elapsedMs).toBe(1000)
    expect(result.duplicates).toEqual([UUID_1])
  })

  it('an id already stored goes to duplicates', () => {
    const result = partitionBatch([offTaskEvent(UUID_1)], new Set([UUID_1]))
    expect(result.accepted).toEqual([])
    expect(result.duplicates).toEqual([UUID_1])
  })

  it('all-new ids go to accepted', () => {
    const result = partitionBatch([offTaskEvent(UUID_1), offTaskEvent(UUID_2)], new Set())
    expect(result.accepted.map((e) => e.clientEventId)).toEqual([UUID_1, UUID_2])
    expect(result.duplicates).toEqual([])
  })
})

describe('services/sessionEvents findImpossibleOffsets', () => {
  const elapsedSeconds = 120
  const maxAllowedElapsedMs = elapsedSeconds * 1000 + EVENT_OFFSET_TOLERANCE_MS

  it('elapsedMs equal to elapsed*1000 + 5000 is allowed', () => {
    expect(findImpossibleOffsets([offTaskEvent(UUID_1, maxAllowedElapsedMs)], maxAllowedElapsedMs)).toEqual([])
  })

  it('one millisecond more is flagged with its clientEventId as impossible_offset', () => {
    expect(
      findImpossibleOffsets([offTaskEvent(UUID_1, maxAllowedElapsedMs + 1)], maxAllowedElapsedMs),
    ).toEqual([UUID_1])
  })

  it('two offenders are both listed', () => {
    const events = [
      offTaskEvent(UUID_1, maxAllowedElapsedMs + 1),
      offTaskEvent(UUID_2, maxAllowedElapsedMs),
      offTaskEvent(UUID_3, maxAllowedElapsedMs + 500),
    ]
    expect(findImpossibleOffsets(events, maxAllowedElapsedMs)).toEqual([UUID_1, UUID_3])
  })
})

describe('services/sessionEvents withReconciliationWarning', () => {
  it('adds reconciliation_warning true and keeps details.alsoOffTask', () => {
    expect(withReconciliationWarning({ alsoOffTask: true })).toEqual({
      alsoOffTask: true,
      reconciliation_warning: true,
    })
  })
})

describe('services/sessionEvents clock_gap shape (buildEventInsertRow)', () => {
  it('an event stored without details.resolution round-trips with no resolution key present', () => {
    const event: EventInputValue = {
      clientEventId: UUID_1,
      type: 'clock_gap',
      elapsedMs: 1000,
      occurredAt: '2026-09-10T09:00:00.000Z',
      details: { gapSeconds: 90 },
    }
    const row = buildEventInsertRow({
      sessionId: SESSION_ID,
      event,
      receivedAt: new Date('2026-09-10T09:00:05.000Z'),
      reconciliationWarning: false,
    })
    expect(row.details).toEqual({ gapSeconds: 90 })
    expect('resolution' in row.details).toBe(false)
  })

  it('an event with resolution "continued" round-trips unchanged', () => {
    const event: EventInputValue = {
      clientEventId: UUID_1,
      type: 'clock_gap',
      elapsedMs: 1000,
      occurredAt: '2026-09-10T09:00:00.000Z',
      details: { gapSeconds: 90, resolution: 'continued' },
    }
    const row = buildEventInsertRow({
      sessionId: SESSION_ID,
      event,
      receivedAt: new Date('2026-09-10T09:00:05.000Z'),
      reconciliationWarning: false,
    })
    expect(row.details).toEqual({ gapSeconds: 90, resolution: 'continued' })
  })
})

describe('services/sessionEvents canVoid', () => {
  it('finalized -> refused (already_finalized)', () => {
    expect(canVoid('finalized')).toBe(false)
  })

  it('running, paused, awaiting_review and abandoned -> allowed', () => {
    expect(canVoid('running')).toBe(true)
    expect(canVoid('paused')).toBe(true)
    expect(canVoid('awaiting_review')).toBe(true)
    expect(canVoid('abandoned')).toBe(true)
  })
})

describe('services/sessionEvents isVoidableType', () => {
  it('off_task, external, agent_check, clock_gap and visibility -> true', () => {
    expect(isVoidableType('off_task')).toBe(true)
    expect(isVoidableType('external')).toBe(true)
    expect(isVoidableType('agent_check')).toBe(true)
    expect(isVoidableType('clock_gap')).toBe(true)
    expect(isVoidableType('visibility')).toBe(true)
  })

  it('pause and resume -> false', () => {
    expect(isVoidableType('pause')).toBe(false)
    expect(isVoidableType('resume')).toBe(false)
  })
})

describe('services/sessionEvents repository guard', () => {
  it('every file under apps/api/src/routes and apps/api/src/services that inserts into sessionEvents is services/session.ts (a hidden tab can never create an episode server-side)', () => {
    const srcDir = fileURLToPath(new URL('../../src', import.meta.url))
    const scannedDirs = ['routes', 'services']
    const insertPattern = /\.insert\(\s*sessionEvents\s*\)/

    function walk(dir: string): string[] {
      const results: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...walk(full))
        } else if (extname(entry.name) === '.ts') {
          results.push(full)
        }
      }
      return results
    }

    const offenders: string[] = []
    for (const scannedDir of scannedDirs) {
      for (const filePath of walk(join(srcDir, scannedDir))) {
        const text = readFileSync(filePath, 'utf8')
        if (insertPattern.test(text) && !filePath.replace(/\\/g, '/').endsWith('services/session.ts')) {
          offenders.push(filePath)
        }
      }
    }

    expect(offenders).toEqual([])

    // The allowlisted file itself really does insert into sessionEvents —
    // this guard is meaningless if session.ts's own insert silently stopped
    // matching the pattern (e.g. after a reformat).
    const sessionServiceText = readFileSync(join(srcDir, 'services', 'session.ts'), 'utf8')
    expect(insertPattern.test(sessionServiceText)).toBe(true)
  })
})
