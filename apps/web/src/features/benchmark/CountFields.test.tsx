import { useState } from 'react'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { renderWithProviders } from '../../test/renderWithProviders.js'
import { BLANK_COUNT_FIELDS_VALUE, CountFields, FirstSwitchPreview, type CountFieldsValue } from './CountFields.js'

/**
 * task 8.4.3's named CountFields cases. `CountFields` is fully controlled
 * (props: session, value, onChange — never its own local count state), so
 * every case here mounts a small stateful `Harness` that owns the value the
 * way `BenchmarkReviewPage` will, matching `Scoring.test.tsx`'s
 * isolated-component style but with real two-way binding so a rendered
 * input reflects what the component itself reported upward. A hidden
 * `<pre data-testid="debug-value">` dumps the current `CountFieldsValue` as
 * JSON so assertions can check exact wire-shaped fields (e.g. `countMethod:
 * 'retrospective'`) the same way the brief's case names state them, without
 * reaching into `toFinalizeReview` from this file (that pure function has
 * its own test file).
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

function makeEvent(overrides: Partial<EventResponseValue> = {}): EventResponseValue {
  return {
    id: overrides.id ?? '99999999-9999-4999-8999-999999999999',
    clientEventId: overrides.clientEventId ?? '88888888-8888-4888-8888-888888888888',
    type: 'off_task',
    elapsedMs: null,
    occurredAt: '2026-09-08T09:05:00.000Z',
    receivedAt: '2026-09-08T09:05:00.000Z',
    details: {},
    voidedAt: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return {
    id: SESSION_ID,
    programId: '22222222-2222-4222-8222-222222222222',
    slotId: '33333333-3333-4333-8333-333333333333',
    revisionId: '44444444-4444-4444-8444-444444444444',
    realm: 'demo',
    kind: 'benchmark',
    lifecycle: 'awaiting_review',
    targetSeconds: 1200,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: '2026-09-08T09:20:00.000Z',
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-08',
    intendedOutput: null,
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: '2026-09-08T09:23:30.000Z',
    timing: { elapsedSeconds: 1200, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: {
      sessionId: SESSION_ID,
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
      externalCount: null,
      unplannedAgentChecks: null,
      mindWanderingCount: null,
      outputQuality: null,
      outputNote: null,
      reviewNote: null,
      materiallyDisrupted: null,
      disruptionNote: null,
      recallPoints: null,
      recallStartedAt: null,
      recallLockedAt: null,
      recallDelaySeconds: null,
      recallDurationSeconds: null,
      recallFlags: [],
      recallScores: null,
      recallScore: null,
      conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
      finalizedAt: null,
      version: 1,
    },
    agentPlan: null,
    amendments: [],
    ...overrides,
  }
}

interface HarnessProps {
  readonly session: SessionResponseValue
  readonly initial?: CountFieldsValue
}

function Harness({ session, initial = BLANK_COUNT_FIELDS_VALUE }: HarnessProps) {
  const [value, setValue] = useState<CountFieldsValue>(initial)
  return (
    <div>
      <CountFields session={session} value={value} onChange={setValue} />
      <pre data-testid="debug-value">{JSON.stringify(value)}</pre>
    </div>
  )
}

function renderHarness(session: SessionResponseValue) {
  return renderWithProviders(<Harness session={session} />)
}

function readDebugValue(): CountFieldsValue {
  return JSON.parse(screen.getByTestId('debug-value').textContent ?? '{}') as CountFieldsValue
}

afterEach(() => {
  cleanup()
})

describe('CountFields', () => {
  it('no events -> S and E start blank with the leave-blank-if-unknown placeholder and no badge', () => {
    const session = makeSession({ events: [] })

    renderHarness(session)

    const sInput = screen.getByLabelText('Off-task episodes (S)')
    const eInput = screen.getByLabelText('External interruptions (E)')
    expect(sInput).toHaveValue('')
    expect(sInput).toHaveAttribute('placeholder', 'leave blank if unknown')
    expect(sInput).not.toBeDisabled()
    expect(eInput).toHaveValue('')
    expect(screen.queryByText(/from recorded events/)).not.toBeInTheDocument()
    expect(readDebugValue()).toEqual(BLANK_COUNT_FIELDS_VALUE)
  })

  it('events -> S prefilled 2 with method event', () => {
    const session = makeSession({
      events: [
        makeEvent({ clientEventId: 'e1', type: 'off_task', elapsedMs: 60_000 }),
        makeEvent({ clientEventId: 'e2', type: 'off_task', elapsedMs: 120_000 }),
        makeEvent({ clientEventId: 'e3', type: 'external', elapsedMs: 30_000 }),
      ],
    })

    renderHarness(session)

    const sInput = screen.getByLabelText('Off-task episodes (S)')
    expect(sInput).toHaveValue('2')
    expect(sInput).toBeDisabled()
    // Both S and E are prefilled here, so the badge legitimately appears
    // twice — once per field.
    expect(screen.getAllByText('from recorded events (method: event)')).toHaveLength(2)
    expect(readDebugValue().countMethod).toBe('event')
    expect(screen.getByLabelText('External interruptions (E)')).toHaveValue('1')
  })

  it('voided off_task events are excluded from the prefilled S', () => {
    const session = makeSession({
      events: [
        makeEvent({ clientEventId: 'e1', type: 'off_task', elapsedMs: 60_000 }),
        makeEvent({ clientEventId: 'e2', type: 'off_task', elapsedMs: 120_000 }),
        makeEvent({ clientEventId: 'e3', type: 'off_task', elapsedMs: 180_000, voidedAt: '2026-09-08T09:10:00.000Z' }),
      ],
    })

    renderHarness(session)

    expect(screen.getByLabelText('Off-task episodes (S)')).toHaveValue('2')
  })

  it('paper tally 4 -> episodeCount 4 and countMethod retrospective', async () => {
    const session = makeSession({
      events: [makeEvent({ clientEventId: 'e1', type: 'off_task', elapsedMs: 60_000 })],
    })

    const { user } = renderHarness(session)

    await user.click(screen.getByRole('button', { name: 'Replace with a paper tally' }))

    const sInput = screen.getByLabelText('Off-task episodes (S)')
    expect(sInput).not.toBeDisabled()
    expect(sInput).toHaveValue('')

    await user.type(sInput, '4')

    expect(sInput).toHaveValue('4')
    const value = readDebugValue()
    expect(value.episodeCount).toBe('4')
    expect(value.countMethod).toBe('retrospective')
  })

  it('explicit 0 -> episodeCount 0 and preview 20+, capped', async () => {
    const session = makeSession({ events: [] })

    const { user } = renderHarness(session)

    await user.type(screen.getByLabelText('Off-task episodes (S)'), '0')

    expect(readDebugValue().episodeCount).toBe('0')
    expect(screen.getByText(/First switch, preview: 20\+, capped/)).toBeInTheDocument()
  })

  it('retrospective 3 without estimate -> Unknown and no 20+ text anywhere', async () => {
    const session = makeSession({ events: [] })

    const { user } = renderHarness(session)

    await user.type(screen.getByLabelText('Off-task episodes (S)'), '3')

    expect(readDebugValue().countMethod).toBe('retrospective')
    expect(screen.getByText(/First switch, preview: Unknown/)).toBeInTheDocument()
    expect(screen.queryByText(/20\+/)).not.toBeInTheDocument()
  })

  it('estimate 6 -> ≈ 6 min (estimate) preview label', async () => {
    const session = makeSession({ events: [] })

    const { user } = renderHarness(session)

    await user.type(screen.getByLabelText('Off-task episodes (S)'), '3')
    await user.type(screen.getByLabelText('Estimated minute of first switch'), '6')

    expect(readDebugValue().estimateMinutes).toBe('6')
    expect(screen.getByText(/First switch, preview: ≈ 6 min \(estimate\)/)).toBeInTheDocument()
  })

  it('first off_task event at 370000 ms -> 6:10 (event)', () => {
    const session = makeSession({
      events: [makeEvent({ clientEventId: 'e1', type: 'off_task', elapsedMs: 370_000 })],
    })

    renderHarness(session)

    expect(screen.getByText(/First switch, preview: 6:10 \(event\)/)).toBeInTheDocument()
  })

  it('M is labeled descriptive only', () => {
    const session = makeSession({ events: [] })

    renderHarness(session)

    const label = screen.getByText('Noticed mind-wandering (M)')
    expect(label).toBeInTheDocument()
    expect(screen.getByText('descriptive only')).toBeInTheDocument()
    expect(screen.getByLabelText('Noticed mind-wandering (M)')).toHaveAttribute(
      'aria-describedby',
      'mind-wandering-count-hint',
    )
  })

  it('estimate 25 is rejected client-side', async () => {
    const session = makeSession({ events: [] })

    const { user } = renderHarness(session)

    await user.type(screen.getByLabelText('Off-task episodes (S)'), '3')
    const estimateInput = screen.getByLabelText('Estimated minute of first switch')
    await user.type(estimateInput, '25')

    // "2" is accepted (<= 20); the next keystroke would make "25" (> 20) and
    // is ignored outright, so the committed value never reaches "25".
    expect(estimateInput).toHaveValue('2')
    expect(readDebugValue().estimateMinutes).toBe('2')
  })

  it('External interruptions stays editable when prefilled from events, and its badge clears on the first edit', async () => {
    const session = makeSession({
      events: [makeEvent({ clientEventId: 'e1', type: 'external', elapsedMs: 30_000 })],
    })

    const { user } = renderHarness(session)

    const eInput = screen.getByLabelText('External interruptions (E)')
    expect(eInput).toHaveValue('1')
    expect(eInput).not.toBeDisabled()
    // This session has no off-task events, so S is also prefilled (to "0",
    // per prefillCounts's "any counted event -> all three tallies together"
    // rule) and carries the same badge — assert via the field's own
    // aria-describedby hint rather than by text, so this stays specific to E.
    const eHintId = eInput.getAttribute('aria-describedby')
    expect(eHintId).not.toBeNull()
    expect(document.getElementById(eHintId ?? '')).toHaveTextContent('from recorded events (method: event)')

    await user.clear(eInput)
    await user.type(eInput, '5')

    expect(eInput).toHaveValue('5')
    expect(eInput).not.toHaveAttribute('aria-describedby')
    expect(readDebugValue().externalCount).toBe('5')
  })
})

// Exercised indirectly by every case above via `CountFields`; imported
// directly too so a future refactor that stops re-exporting
// `FirstSwitchPreview` from `CountFields.tsx` fails typecheck here rather
// than silently.
describe('FirstSwitchPreview', () => {
  it('renders nothing when firstSwitch is null (episodeCount blank)', () => {
    const { container } = renderWithProviders(<FirstSwitchPreview firstSwitch={null} estimateMinutes="" />)
    expect(container.textContent).toBe('')
  })
})
