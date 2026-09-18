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

  it('attempts table wrapper is relative so the sr-only Actions header cannot escape the scroll clip (task V5 check 1)', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-relative', label: 'A' })
    mount(makeReport({ attempts: [attempt] }))

    const table = await screen.findByRole('table', { name: 'Benchmark attempts' })
    const wrapper = table.parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain('relative')
    expect(wrapper?.className).toContain('overflow-x-auto')
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
    expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
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

    const cappedCell = await screen.findByTestId('t-attempt-capped')
    expect(cappedCell).toHaveTextContent('20+, capped')
    // '20+, capped' is a measurement (twenty minutes elapsed, no switch) —
    // named RECORDED explicitly here rather than trusted to a default; this
    // is the value the three-tier taxonomy exists to protect (the rework spec §5).
    expect(cappedCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const knownCell = screen.getByTestId('t-attempt-known')
    expect(knownCell).toHaveTextContent('6:10')
    expect(knownCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const unknownCell = screen.getByTestId('t-attempt-unknown')
    expect(unknownCell).toHaveTextContent('Unknown')
    expect(unknownCell.textContent).not.toContain('20+')
    expect(unknownCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'uncertain')
  })

  it('null recall renders Not reported', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-recall', label: 'A', recallScore: null })
    mount(makeReport({ attempts: [attempt] }))

    const cell = await screen.findByTestId('recall-attempt-recall')
    expect(cell).toHaveTextContent('Not reported')
    expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
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
    // `Button asChild` must render the Radix Slot's CHILD element (the real
    // `<a>`), never a `<button>` wrapping an anchor — the rework spec §12
    // ("Open questions and risks") calls this the highest-risk single change.
    expect(setupLink.tagName).toBe('A')
    expect(setupLink.closest('button')).toBeNull()
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
      const cell = screen.getByTestId(`${id}-attempt-running`)
      expect(cell).toHaveTextContent('Not finalized')
      expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
    }

    expect(within(container).queryByText('Explain or exclude')).not.toBeInTheDocument()
  })

  it('eligibility, exclusion reasons and protocol revision are tiered: Eligible/a reason list are recorded, the — dash is absent', async () => {
    const eligible = makeAttempt({ attemptId: 'attempt-eligible', label: 'A' })
    const ineligible = makeAttempt({
      attemptId: 'attempt-ineligible',
      label: 'B',
      eligible: false,
      exclusionReasons: ['count_unknown'],
      revisionId: 'rev-missing',
    })
    mount(makeReport({ attempts: [eligible, ineligible] }))

    const eligibleCell = await screen.findByTestId('eligibility-attempt-eligible')
    expect(eligibleCell).toHaveTextContent('Eligible')
    expect(eligibleCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const ineligibleCell = screen.getByTestId('eligibility-attempt-ineligible')
    expect(ineligibleCell).toHaveTextContent('Not eligible')
    expect(ineligibleCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const noExclusionCell = screen.getByTestId('exclusion-attempt-eligible')
    expect(noExclusionCell).toHaveTextContent('—')
    expect(noExclusionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')

    const withExclusionCell = screen.getByTestId('exclusion-attempt-ineligible')
    expect(withExclusionCell).toHaveTextContent(EXCLUSION_REASON_COPY.count_unknown)
    expect(withExclusionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    // attempt-ineligible's revisionId ('rev-missing') matches no revision in
    // the mounted report's `revisions: [REVISION]` (id 'rev-1'), so
    // `withRevisionNumbers` (Progress.tsx) maps it to `revisionNumber: null`
    // — rendered as the dash, same as an unreported count.
    const revisionCell = screen.getByTestId('revision-attempt-ineligible')
    expect(revisionCell).toHaveTextContent('—')
    expect(revisionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })

  it('the Conditions and Exclusion-reasons cells wrap prose, numeric cells stay nowrap, and body cells align to top', async () => {
    const attempt = makeAttempt({
      attemptId: 'attempt-wrap',
      label: 'A',
      eligible: false,
      exclusionReasons: ['count_unknown'],
    })
    mount(makeReport({ attempts: [attempt] }))

    const exclusionCell = await screen.findByTestId('exclusion-attempt-wrap')
    expect(exclusionCell.className).toContain('whitespace-normal')
    expect(exclusionCell.className).toContain('align-top')

    const conditionsCell = screen.getByTestId('conditions-attempt-wrap')
    expect(conditionsCell.className).toContain('whitespace-normal')

    const sCell = screen.getByTestId('s-attempt-wrap')
    expect(sCell.className).not.toContain('whitespace-normal')
    expect(sCell.className).toContain('align-top')
  })

  it('column headers can wrap on a narrow screen, not forced onto one unbreakable line', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-header-wrap', label: 'A' })
    mount(makeReport({ attempts: [attempt] }))

    const header = await screen.findByRole('columnheader', { name: 'Exclusion reasons' })
    expect(header.className).toContain('whitespace-normal')

    const actionsHeader = screen.getByRole('columnheader', { name: 'Actions' })
    expect(actionsHeader.className).toContain('whitespace-normal')
  })

  it('the Date cell renders the local date in the mono face with tabular figures, matching the app\'s other dense tables', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-date-mono', label: 'A', localDate: '2026-09-06' })
    mount(makeReport({ attempts: [attempt] }))

    const row = (await screen.findByText('2026-09-06')).closest('td')
    expect(row).not.toBeNull()
    expect(row!.className).toContain('font-mono')
    expect(row!.className).toContain('tabular-nums')
  })

  it('GET /programs/current failure renders through the shared ErrorState: role alert, message unchanged, exactly one Retry (guard: already an Alert)', async () => {
    mockApi.programs.current.mockRejectedValue(new Error('network exploded'))

    renderWithProviders(<Progress />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Report unavailable. Retry.')
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('the report query failure renders through the shared ErrorState: role alert, message unchanged, exactly one Retry (guard: already an Alert)', async () => {
    respond('programs.current', PROGRAM)
    mockApi.report.get.mockRejectedValue(new Error('network exploded'))

    renderWithProviders(<Progress />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Report unavailable. Retry.')
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('while programs.current is pending, an aria-busy region shows the visible label Loading', () => {
    mockApi.programs.current.mockReturnValue(new Promise(() => {}))

    renderWithProviders(<Progress />)

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
  })

  it('while the report query is pending, an aria-busy region shows the visible label Loading report', async () => {
    respond('programs.current', PROGRAM)
    mockApi.report.get.mockReturnValue(new Promise(() => {}))

    renderWithProviders(<Progress />)

    const label = await screen.findByText('Loading report')
    expect(label.closest('[aria-busy="true"]')).not.toBeNull()
  })
})
