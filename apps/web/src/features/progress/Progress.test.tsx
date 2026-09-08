import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { AttemptValue, CurrentProgramResponseValue, ReportResponseValue } from '@attention-lab/shared'
import { EXCLUSION_REASON_COPY } from '@attention-lab/shared'

import { NotFoundError, ValidationError } from '../../lib/api/errors.js'
import { expectNoIdentifiers } from '../../test/expectNoIdentifiers.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { Progress } from './Progress.js'

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render.
afterEach(() => {
  cleanup()
})

const PROGRAM: CurrentProgramResponseValue = {
  program: {
    id: 'program-1',
    realm: 'demo',
    status: 'active',
    baselineDate: '2026-09-06',
    timezone: 'America/Los_Angeles',
    leisureAllowanceMinutes: 20,
    feedEstimateMinutes: null,
    currentRevisionId: 'rev-1',
    version: 1,
  },
  revision: null,
  slots: [],
  day: 4,
  nextAction: { kind: 'progress' },
}

const REVISION = {
  id: 'rev-1',
  revision: 1,
  effectiveDay: 0,
  settings: { practiceTargetSeconds: 600, bandCeilings: [], leisureAllowanceMin: 20 },
  reason: 'initial',
  createdAt: '2026-09-06T00:00:00.000Z',
}

function makeAttempt(overrides: Partial<AttemptValue> & Pick<AttemptValue, 'attemptId' | 'label'>): AttemptValue {
  return {
    phase: 'baseline',
    realm: 'demo',
    timeSource: 'measured',
    eligible: true,
    exclusionReasons: [],
    episodeCount: 2,
    recallScore: 4,
    firstSwitch: { kind: 'known', seconds: 120 },
    firstSwitchMethod: 'event',
    externalCount: 1,
    unplannedAgentChecks: 0,
    countMethod: 'event',
    conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    localDate: '2026-09-06',
    lifecycle: 'finalized',
    replacementReason: null,
    recallFlags: [],
    revisionId: 'rev-1',
    mindWanderingCount: 1,
    materiallyDisrupted: false,
    timerQuality: 'ok',
    excludedByAmendment: false,
    ...overrides,
  }
}

function makeReport(overrides: Partial<ReportResponseValue> = {}): ReportResponseValue {
  return {
    realm: 'demo',
    samples: { baselineEligible: 0, finalEligible: 0 },
    attempts: [],
    resultState: 'baseline_pending',
    warnings: [],
    practice: [],
    days: [],
    revisions: [REVISION],
    ...overrides,
  }
}

/** Mocks `programs.current` (a real program exists) and `report.get` in one call. */
function mount(report: ReportResponseValue) {
  respond('programs.current', PROGRAM)
  respond('report.get', report)
  return renderWithProviders(<Progress />)
}

describe('Progress', () => {
  it('one eligible baseline renders 1 of 2 baseline samples eligible and lists B with its EXCLUSION_REASON_COPY', async () => {
    const attemptA = makeAttempt({ attemptId: 'attempt-a', label: 'A', episodeCount: 2 })
    const attemptB = makeAttempt({
      attemptId: 'attempt-b',
      label: 'B',
      eligible: false,
      exclusionReasons: ['count_unknown'],
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
    })
    mount(makeReport({ samples: { baselineEligible: 1, finalEligible: 0 }, attempts: [attemptA, attemptB] }))

    expect(await screen.findByText('1 of 2 baseline samples eligible · 0 of 2 final samples eligible')).toBeInTheDocument()
    expect(screen.getByText(EXCLUSION_REASON_COPY.count_unknown)).toBeInTheDocument()
  })

  it('null S renders Not reported and the S cell never contains 0', async () => {
    const attempt = makeAttempt({
      attemptId: 'attempt-null-s',
      label: 'A',
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
    })
    mount(makeReport({ attempts: [attempt] }))

    const cell = await screen.findByTestId('s-attempt-null-s')
    expect(cell).toHaveTextContent('Not reported')
    expect(cell.textContent).not.toBe('0')
  })

  it('T none_capped renders 20+, capped; known 370 s renders 6:10; unknown renders Unknown and never 20+', async () => {
    const capped = makeAttempt({ attemptId: 'attempt-capped', label: 'A', firstSwitch: { kind: 'none_capped' } })
    const known = makeAttempt({
      attemptId: 'attempt-known',
      label: 'B',
      phase: 'final',
      firstSwitch: { kind: 'known', seconds: 370 },
    })
    const unknown = makeAttempt({
      attemptId: 'attempt-unknown',
      label: 'A',
      phase: 'final',
      countMethod: 'retrospective',
      firstSwitch: { kind: 'unknown' },
      firstSwitchMethod: null,
    })
    mount(makeReport({ attempts: [capped, known, unknown] }))

    expect(await screen.findByTestId('t-attempt-capped')).toHaveTextContent('20+, capped')
    expect(screen.getByTestId('t-attempt-known')).toHaveTextContent('6:10')
    const unknownCell = screen.getByTestId('t-attempt-unknown')
    expect(unknownCell).toHaveTextContent('Unknown')
    expect(unknownCell.textContent).not.toContain('20+')
  })

  it('null recall renders Not reported', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-recall', label: 'A', recallScore: null })
    mount(makeReport({ attempts: [attempt] }))

    expect(await screen.findByTestId('recall-attempt-recall')).toHaveTextContent('Not reported')
  })

  it('All counts are self-reported is present', async () => {
    mount(makeReport())

    expect(await screen.findByText('All counts are self-reported')).toBeInTheDocument()
  })

  it('realm demo renders Demonstration data and expectNoIdentifiers passes', async () => {
    // No demo_clock time source here on purpose: 'Demo clock' would contain
    // the standalone word 'Demo' that expectNoIdentifiers flags, and this
    // test's job is to prove the realm label — not the time-source label —
    // never leaks the raw 'demo' word.
    const attempt = makeAttempt({ attemptId: 'attempt-a', label: 'A', timeSource: 'measured' })
    const { container } = mount(makeReport({ realm: 'demo', attempts: [attempt] }))

    expect(await screen.findByText('Demonstration data')).toBeInTheDocument()
    expect(() => expectNoIdentifiers(container)).not.toThrow()
  })

  it('422 realm mixing renders the server message and no attempt rows', async () => {
    respond('programs.current', PROGRAM)
    const error = new ValidationError(422, {
      code: 'realm_mismatch',
      message: "Refusing to compare a 'demo' record with a 'pilot' record.",
      retryable: false,
      requestId: 'req-1',
    })
    mockApi.report.get.mockRejectedValue(error)

    renderWithProviders(<Progress />)

    expect(
      await screen.findByText("Refusing to compare a 'demo' record with a 'pilot' record."),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('GET /programs/current 404 renders the empty state with a Setup link and no numeric cards', async () => {
    const error = new NotFoundError(404, {
      code: 'not_found',
      message: 'No program was found.',
      retryable: false,
      requestId: 'req-1',
    })
    mockApi.programs.current.mockRejectedValue(error)

    renderWithProviders(<Progress />)

    const setupLink = await screen.findByRole('link', { name: /setup/i })
    expect(setupLink).toHaveAttribute('href', '/setup')
    expect(screen.queryByText(/of 2/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('time source demo_clock renders Demo clock and two none_capped plus two known attempts list four T values', async () => {
    const cappedA = makeAttempt({
      attemptId: 'attempt-capped-a',
      label: 'A',
      timeSource: 'demo_clock',
      firstSwitch: { kind: 'none_capped' },
    })
    const cappedB = makeAttempt({
      attemptId: 'attempt-capped-b',
      label: 'B',
      timeSource: 'demo_clock',
      firstSwitch: { kind: 'none_capped' },
    })
    const knownA = makeAttempt({
      attemptId: 'attempt-known-a',
      label: 'A',
      phase: 'final',
      timeSource: 'demo_clock',
      firstSwitch: { kind: 'known', seconds: 90 },
    })
    const knownB = makeAttempt({
      attemptId: 'attempt-known-b',
      label: 'B',
      phase: 'final',
      timeSource: 'demo_clock',
      firstSwitch: { kind: 'known', seconds: 245 },
    })
    mount(makeReport({ attempts: [cappedA, cappedB, knownA, knownB] }))

    expect((await screen.findAllByText('Demo clock')).length).toBe(4)
    expect(screen.getByTestId('t-attempt-capped-a')).toHaveTextContent('20+, capped')
    expect(screen.getByTestId('t-attempt-capped-b')).toHaveTextContent('20+, capped')
    expect(screen.getByTestId('t-attempt-known-a')).toHaveTextContent('1:30')
    expect(screen.getByTestId('t-attempt-known-b')).toHaveTextContent('4:05')
  })

  it('a running attempt renders its lifecycle word and Not finalized in every scored column, with no Explain or exclude control', async () => {
    const attempt = makeAttempt({
      attemptId: 'attempt-running',
      label: 'A',
      lifecycle: 'running',
      eligible: false,
      exclusionReasons: [],
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
      recallScore: null,
      externalCount: null,
      mindWanderingCount: null,
      materiallyDisrupted: null,
    })
    const { container } = mount(makeReport({ attempts: [attempt] }))

    await waitFor(() => expect(screen.getByTestId('status-attempt-running')).toBeInTheDocument())
    expect(screen.getByTestId('status-attempt-running')).toHaveTextContent('Running')

    const scoredTestIds = ['s', 't', 'recall', 'e', 'm', 'disruption', 'eligibility']
    for (const id of scoredTestIds) {
      expect(screen.getByTestId(`${id}-attempt-running`)).toHaveTextContent('Not finalized')
    }

    expect(within(container).queryByText('Explain or exclude')).not.toBeInTheDocument()
  })
})
