import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { URL as NodeURL, fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { DayRowValue, PracticeRowValue } from '@attention-lab/shared'

import { setPrefersReducedMotion } from '../../test/setup.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { DailyTrend } from './DailyTrend.js'
import { PracticeTrend } from './PracticeTrend.js'
import { FEED_SOURCE_LABEL } from './trendFormat.js'

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render.
afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// recharts is replaced with lightweight stand-ins for every test in this
// file. This is deliberate, not a shortcut: `ResponsiveContainer` never
// reports a non-zero size in jsdom (no `ResizeObserver`), and PracticeTrend/
// DailyTrend don't use it for exactly that reason (see their own header
// comments) — rendering the REAL chart primitives at a fixed pixel size
// would still exercise recharts' own SVG/text-measurement internals, which
// is recharts' test suite's job, not this task's. Mocking lets these tests
// assert precisely on what PracticeTrend/DailyTrend themselves compute and
// pass down — `data`, `isAnimationActive`, `connectNulls` — deterministically
// and fast. Real integration (the chart actually painting) is 8.8.5's
// Playwright sweep against a real browser, which has a real ResizeObserver.
// ---------------------------------------------------------------------------
interface RechartsCaptured {
  barChartData?: unknown
  lineChartData?: unknown
}

vi.mock('recharts', () => {
  const captured: RechartsCaptured = {}

  function BarChart({ data, children }: { data?: unknown; children?: ReactNode }) {
    captured.barChartData = data
    return <div data-testid="mock-barchart">{children}</div>
  }
  function LineChart({ data, children }: { data?: unknown; children?: ReactNode }) {
    captured.lineChartData = data
    return <div data-testid="mock-linechart">{children}</div>
  }
  function Bar({ dataKey, isAnimationActive }: { dataKey: string; isAnimationActive?: boolean }) {
    return <div data-testid={`bar-${dataKey}`} data-animate={String(isAnimationActive)} />
  }
  function Line({
    dataKey,
    isAnimationActive,
    connectNulls,
  }: {
    dataKey: string
    isAnimationActive?: boolean
    connectNulls?: boolean
  }) {
    return (
      <div
        data-testid={`line-${dataKey}`}
        data-animate={String(isAnimationActive)}
        data-connect-nulls={String(connectNulls)}
      />
    )
  }
  const Noop = () => null

  return {
    __captured: captured,
    BarChart,
    LineChart,
    Bar,
    Line,
    CartesianGrid: Noop,
    XAxis: Noop,
    YAxis: Noop,
    Tooltip: Noop,
    Legend: Noop,
  }
})

// eslint-disable-next-line import/first -- must follow the vi.mock('recharts', ...) call above
import * as Recharts from 'recharts'

function getCaptured(): RechartsCaptured {
  return (Recharts as unknown as { __captured: RechartsCaptured }).__captured
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePracticeRow(
  overrides: Partial<PracticeRowValue> & Pick<PracticeRowValue, 'sessionId' | 'day' | 'localDate' | 'targetSeconds'>,
): PracticeRowValue {
  return {
    completeInterval: true,
    outputQuality: 'yes',
    episodeCount: 1,
    externalCount: 0,
    unplannedAgentChecks: 0,
    revisionId: 'rev-1',
    lifecycle: 'finalized',
    completedSeconds: null,
    timerQuality: 'ok',
    countMethod: 'event',
    mindWanderingCount: 0,
    ...overrides,
  }
}

function makeDayRow(overrides: Partial<DayRowValue> & Pick<DayRowValue, 'localDate' | 'day'>): DayRowValue {
  return {
    status: 'complete',
    sleepMinutes: 420,
    stress: 4,
    mindfulnessMinutes: 10,
    feedDeviceMinutes: 45,
    partial: false,
    feedByDevice: { phone: 30, desktop: 15, tablet: null, unspecified: null },
    ...overrides,
  }
}

describe('PracticeTrend / DailyTrend / ExactValuesTable', () => {
  it('practice growth 10 → 25 renders those durations in the practice table and none of them appears in ComparisonFigures', () => {
    const rows = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 540 }),
      makePracticeRow({ sessionId: 's2', day: 2, localDate: '2026-09-02', targetSeconds: 1500, completedSeconds: 1440 }),
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    // PracticeTrend takes no comparison data at all (8.8.2's ComparisonFigures
    // is a sibling task, not mounted here) — proving it renders none of that
    // component's percentage/attention-delta framing.
    expect(screen.queryByText(/percentage reduction|attention \+|confidence interval/i)).not.toBeInTheDocument()
  })

  it('a practice block on Day 14 appears in the practice table only', () => {
    const row = makePracticeRow({
      sessionId: 's14',
      day: 14,
      localDate: '2026-09-14',
      targetSeconds: 900,
      completedSeconds: 900,
    })
    renderWithProviders(<PracticeTrend practice={[row]} />)

    expect(screen.getByText('14')).toBeInTheDocument()
    // Only the practice section's own columns exist here — none of
    // AttemptTable's benchmark-only columns — confirming this row lives in
    // the practice table, never mistaken for a benchmark attempt.
    expect(screen.queryByText('Eligibility')).not.toBeInTheDocument()
    expect(screen.queryByText('Phase')).not.toBeInTheDocument()
  })

  it('Day 9 with no check-in renders Not reported and its chart datum is null, not 0', () => {
    const days = [
      makeDayRow({ localDate: '2026-09-08', day: 8, sleepMinutes: 400 }),
      makeDayRow({
        localDate: '2026-09-09',
        day: 9,
        status: 'not_reported',
        sleepMinutes: null,
        stress: null,
        mindfulnessMinutes: null,
        feedDeviceMinutes: null,
        partial: true,
        feedByDevice: { phone: null, desktop: null, tablet: null, unspecified: null },
      }),
    ]
    renderWithProviders(<DailyTrend days={days} />)

    const day9Row = screen.getAllByRole('row').find((row) => within(row).queryByText('9') !== null)
    expect(day9Row).toBeDefined()
    expect(within(day9Row as HTMLElement).getAllByText('Not reported').length).toBeGreaterThan(0)

    const chartData = getCaptured().lineChartData as ReadonlyArray<{ day: number; sleepMinutes: number | null }>
    const day9Datum = chartData.find((datum) => datum.day === 9)
    expect(day9Datum).toBeDefined()
    expect(day9Datum?.sleepMinutes).toBeNull()
    expect(day9Datum?.sleepMinutes).not.toBe(0)
  })

  it('blank practice counts render Not reported', () => {
    const row = makePracticeRow({
      sessionId: 's-blank',
      day: 5,
      localDate: '2026-09-05',
      targetSeconds: 900,
      completedSeconds: null,
      outputQuality: null,
      episodeCount: null,
      externalCount: null,
      unplannedAgentChecks: null,
      countMethod: null,
    })
    renderWithProviders(<PracticeTrend practice={[row]} />)

    // Completed (min), Output quality, S, E, Agent checks, Time source.
    const notReported = screen.getAllByText('Not reported')
    expect(notReported.length).toBeGreaterThanOrEqual(6)
    for (const cell of notReported) {
      expect(cell.textContent).not.toBe('0')
    }
  })

  it('feed totals are labelled device-minutes', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    expect(screen.getAllByText(/device-minutes/i).length).toBeGreaterThan(0)
  })

  it('daily rows show the source label Estimate or From device report and both tables carry the self-reported label', () => {
    const practice = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
    ]
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(
      <>
        <PracticeTrend practice={practice} />
        <DailyTrend days={days} />
      </>,
    )

    expect(screen.getByText(new RegExp(FEED_SOURCE_LABEL.estimate))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(FEED_SOURCE_LABEL.device_report))).toBeInTheDocument()
    expect(screen.getAllByText(/self-reported/i).length).toBeGreaterThanOrEqual(2)
  })

  it('charts are aria-hidden and the tables are not', () => {
    const practice = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
    ]
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(
      <>
        <PracticeTrend practice={practice} />
        <DailyTrend days={days} />
      </>,
    )

    expect(screen.getByTestId('practice-trend-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('daily-trend-chart')).toHaveAttribute('aria-hidden', 'true')

    const tables = screen.getAllByRole('table')
    expect(tables.length).toBe(2)
    for (const table of tables) {
      expect(table).not.toHaveAttribute('aria-hidden')
    }
  })

  it('prefers-reduced-motion disables chart animation', () => {
    const practice = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
    ]
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]

    const { unmount } = renderWithProviders(
      <>
        <PracticeTrend practice={practice} />
        <DailyTrend days={days} />
      </>,
    )
    expect(screen.getByTestId('bar-plannedMinutes')).toHaveAttribute('data-animate', 'true')
    expect(screen.getByTestId('line-sleepMinutes')).toHaveAttribute('data-animate', 'true')
    unmount()

    setPrefersReducedMotion(true)
    try {
      renderWithProviders(
        <>
          <PracticeTrend practice={practice} />
          <DailyTrend days={days} />
        </>,
      )
      expect(screen.getByTestId('bar-plannedMinutes')).toHaveAttribute('data-animate', 'false')
      expect(screen.getByTestId('bar-completedMinutes')).toHaveAttribute('data-animate', 'false')
      expect(screen.getByTestId('line-sleepMinutes')).toHaveAttribute('data-animate', 'false')
    } finally {
      setPrefersReducedMotion(false)
    }
  })

  it('grep test: no file outside apps/web/src/features/progress imports recharts', () => {
    // `apps/web/src`, resolved relative to this file (features/progress) so
    // it works regardless of the process's current working directory —
    // matches `reducedMotion.test.ts`'s own `fileURLToPath` convention.
    // Uses `node:url`'s own `URL` rather than the jsdom-project's global
    // `URL` (jsdom's WHATWG-url polyfill resolves a relative reference
    // against a Windows `file:///C:/...` base incorrectly — verified this
    // reliably reproduces `http://localhost:3000/src` instead of the real
    // parent directory, only in the `jsdom` vitest project).
    const srcRoot = fileURLToPath(new NodeURL('../../', import.meta.url))
    const RECHARTS_IMPORT = /(?:from\s+['"]recharts['"]|require\(\s*['"]recharts['"]\s*\))/

    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry)
        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          walk(fullPath)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue

        const relPath = relative(srcRoot, fullPath).split(sep).join('/')
        if (relPath.startsWith('features/progress/')) continue
        // `lib/pins.smoke.ts` (Group 7's D3 compatibility gate) imports a
        // `recharts` TYPE only, so `typecheck` exercises the pinned package
        // before any feature depended on it — its own comment says to
        // delete that import "once real imports of every package exist
        // elsewhere", which this task's PracticeTrend/DailyTrend now are.
        // `apps/web/src/lib/**` is a shared file this task must not edit
        // (FILE OWNERSHIP); the removal is reported via
        // `centralWiringNeeded` instead of made here.
        if (relPath === 'lib/pins.smoke.ts') continue

        const content = readFileSync(fullPath, 'utf8')
        if (RECHARTS_IMPORT.test(content)) {
          offenders.push(relPath)
        }
      }
    }
    walk(srcRoot)

    expect(offenders).toEqual([])
  })
})
