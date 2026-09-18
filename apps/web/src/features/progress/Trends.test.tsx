import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { URL as NodeURL, fileURLToPath } from 'node:url'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { DayRowValue, PracticeRowValue } from '@attention-lab/shared'

import { setPrefersReducedMotion } from '../../test/setup.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { DailyTrend } from './DailyTrend.js'
import { PracticeTrend } from './PracticeTrend.js'
import { FEED_SOURCE_LABEL, NOT_REPORTED, formatWholeMinutes } from './trendFormat.js'

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
  barChartBarSize?: number | undefined
  barChartBarGap?: number | undefined
  lineChartData?: unknown
  dailyLegendFormatter?: (value: string) => ReactNode
  tooltipItemStyle?: CSSProperties | undefined
  tooltipLabelStyle?: CSSProperties | undefined
}

vi.mock('recharts', () => {
  const captured: RechartsCaptured = {}

  function BarChart({
    data,
    barSize,
    barGap,
    children,
  }: {
    data?: unknown
    barSize?: number
    barGap?: number
    children?: ReactNode
  }) {
    captured.barChartData = data
    captured.barChartBarSize = barSize
    captured.barChartBarGap = barGap
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

  // Captures the props PracticeTrend/DailyTrend pass to `<Tooltip>`, since
  // real Recharts' `DefaultTooltipContent` colours each item by series
  // unless `itemStyle`/`labelStyle` override it (C-I2).
  function Tooltip({ itemStyle, labelStyle }: { itemStyle?: CSSProperties; labelStyle?: CSSProperties }) {
    captured.tooltipItemStyle = itemStyle
    captured.tooltipLabelStyle = labelStyle
    return null
  }

  // Real Recharts computes a Bar's legend entry from `fill` alone, so a
  // frame-only ("fill=none") planned bar gets a blank swatch (fix round 1,
  // finding 1) — PracticeTrend works around that with a custom `content`
  // renderer. This mock renders that `content` exactly as Recharts' own
  // `Legend` component would: call it if it's a function, render it as-is if
  // it's already an element. `DailyTrend` never passes `content`, so it still
  // renders nothing, same as before this mock grew this branch.
  function Legend({
    content,
    formatter,
  }: {
    content?: ReactNode | ((props: Record<string, never>) => ReactNode)
    formatter?: (value: string) => ReactNode
  }) {
    if (formatter !== undefined) {
      captured.dailyLegendFormatter = formatter
    }
    if (typeof content === 'function') {
      return <>{content({})}</>
    }
    if (content !== undefined && content !== null) {
      return <>{content}</>
    }
    return null
  }

  return {
    __captured: captured,
    BarChart,
    LineChart,
    Bar,
    Line,
    CartesianGrid: Noop,
    XAxis: Noop,
    YAxis: Noop,
    Tooltip,
    Legend,
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

  // Column order is DailyTrend's own COLUMNS (Day, Date, Status, Sleep,
  // Mindfulness, Stress, Phone, Desktop, Tablet, Unspecified, Feed total) —
  // reused by the three tests below (task V1: the daily check-ins table was
  // dividing already-whole minutes by sixty via `formatMinutes`, a
  // seconds-to-minutes formatter never meant for these fields).
  function dailyCellForDay(day: number, columnIndex: number): HTMLElement {
    const row = screen
      .getAllByRole('row')
      .find((candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent === String(day))
    if (row === undefined) throw new Error(`no row rendered for day ${day}`)
    const cell = within(row).getAllByRole('cell')[columnIndex]
    if (cell === undefined) throw new Error(`column ${columnIndex} missing`)
    return cell
  }

  it('daily minutes render as minutes, not divided by sixty (task V1)', () => {
    const days = [
      makeDayRow({
        localDate: '2026-09-01',
        day: 1,
        sleepMinutes: 420,
        mindfulnessMinutes: 10,
        feedDeviceMinutes: 45,
        feedByDevice: { phone: 30, desktop: 15, tablet: null, unspecified: null },
      }),
    ]
    renderWithProviders(<DailyTrend days={days} />)

    expect(dailyCellForDay(1, 3)).toHaveTextContent('420') // Sleep
    expect(dailyCellForDay(1, 4)).toHaveTextContent('10') // Mindfulness
    expect(dailyCellForDay(1, 6)).toHaveTextContent('30') // Phone
    expect(dailyCellForDay(1, 7)).toHaveTextContent('15') // Desktop
  })

  it('an explicit 0 minutes value renders as the recorded 0, never folded into Not reported (task V1)', () => {
    const days = [
      makeDayRow({
        localDate: '2026-09-01',
        day: 1,
        mindfulnessMinutes: 0,
      }),
    ]
    renderWithProviders(<DailyTrend days={days} />)

    const cell = dailyCellForDay(1, 4) // Mindfulness
    const value = cell.querySelector('[data-tier="recorded"]')
    expect(value).not.toBeNull()
    expect(value).toHaveTextContent('0')
  })

  it('a null minutes value renders Not reported in the absent tier, never 0 (task V1)', () => {
    const days = [
      makeDayRow({
        localDate: '2026-09-01',
        day: 1,
        sleepMinutes: null,
        mindfulnessMinutes: null,
        feedDeviceMinutes: null,
        feedByDevice: { phone: null, desktop: null, tablet: null, unspecified: null },
      }),
    ]
    renderWithProviders(<DailyTrend days={days} />)

    for (const columnIndex of [3, 4, 6, 7]) {
      const cell = dailyCellForDay(1, columnIndex)
      expect(cell).toHaveTextContent(NOT_REPORTED)
      const value = cell.querySelector('[data-tier]')
      expect(value).toHaveAttribute('data-tier', 'absent')
    }
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

  it('Timer flag column renders all three tiers: OK recorded, Timing uncertain amber, Not reported absent', () => {
    // `timerQuality` is `Type.Optional` on `PracticeRowValue`, and apps/web
    // runs with `exactOptionalPropertyTypes: true` (tsconfig.base.json), so
    // `makePracticeRow({ ..., timerQuality: undefined })` does not typecheck
    // (TS2379 — an explicit `undefined` is not the same thing as omitting an
    // optional property under that flag). The "not reported" row is built by
    // destructuring the key back OFF a normal row instead: the result
    // genuinely lacks `timerQuality`, which is exactly what "not reported"
    // means, and is still a valid `PracticeRowValue` since the field is
    // optional.
    const { timerQuality: _omittedTimerQuality, ...unsetRow } = makePracticeRow({
      sessionId: 's-unset',
      day: 3,
      localDate: '2026-09-03',
      targetSeconds: 600,
    })
    const rows = [
      makePracticeRow({ sessionId: 's-ok', day: 1, localDate: '2026-09-01', targetSeconds: 600, timerQuality: 'ok' }),
      makePracticeRow({
        sessionId: 's-uncertain',
        day: 2,
        localDate: '2026-09-02',
        targetSeconds: 600,
        timerQuality: 'uncertain',
      }),
      unsetRow,
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    // Column order is COLUMNS' own fixed order (Day, Date, Block, Planned,
    // Completed, Output quality, S, E, Agent checks, Timer flag, Time
    // source) — index 9 is Timer flag.
    function timerCellForDay(day: number): HTMLElement {
      const row = screen
        .getAllByRole('row')
        .find((candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent === String(day))
      if (row === undefined) throw new Error(`no row rendered for day ${day}`)
      const cell = within(row).getAllByRole('cell')[9]
      if (cell === undefined) throw new Error('Timer flag column missing')
      return cell
    }

    const okCell = timerCellForDay(1)
    expect(okCell).toHaveTextContent('OK')
    expect(okCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const uncertainCell = timerCellForDay(2)
    expect(uncertainCell).toHaveTextContent('Timing uncertain')
    expect(uncertainCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'uncertain')

    const unsetCell = timerCellForDay(3)
    expect(unsetCell).toHaveTextContent('Not reported')
    expect(unsetCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })

  it('mono is scoped to figure cells: stress renders mono, a recorded status word does not', () => {
    // Column order is DailyTrend's own COLUMNS (Day, Date, Status, Sleep,
    // Mindfulness, Stress, Phone, Desktop, Tablet, Unspecified, Feed total) —
    // index 2 is Status, index 5 is Stress. Scoped by row + column index, not
    // a bare `getByText`, so another cell with the same text can't retarget
    // this assertion (fix round 1, finding 2's own instruction).
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1, stress: 4, status: 'complete' })]
    renderWithProviders(<DailyTrend days={days} />)

    function dailyCellForDay(day: number, columnIndex: number): HTMLElement {
      const row = screen
        .getAllByRole('row')
        .find((candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent === String(day))
      if (row === undefined) throw new Error(`no row rendered for day ${day}`)
      const cell = within(row).getAllByRole('cell')[columnIndex]
      if (cell === undefined) throw new Error(`column ${columnIndex} missing`)
      return cell
    }

    const stressCell = dailyCellForDay(1, 5)
    const stressValue = stressCell.querySelector('[data-tier="recorded"]')
    expect(stressValue).not.toBeNull()
    expect(stressValue).toHaveTextContent('4')
    expect(stressValue).toHaveClass('font-mono')

    const statusCell = dailyCellForDay(1, 2)
    const statusValue = statusCell.querySelector('[data-tier="recorded"]')
    expect(statusValue).not.toBeNull()
    expect(statusValue).toHaveTextContent('Complete')
    expect(statusValue).not.toHaveClass('font-mono')
  })

  it('ExactValuesTable carries no table-wide font-mono; mono is applied per figure cell only', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    const table = screen.getByRole('table')
    expect(table.className).not.toContain('font-mono')
  })

  it('ExactValuesTable wrapper is relative so its sr-only caption cannot escape the scroll clip (task V5 check 1)', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    const table = screen.getByRole('table')
    const wrapper = table.parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain('relative')
    expect(wrapper?.className).toContain('overflow-x-auto')
  })

  it('ExactValuesTable header cells wrap and body cells stay top-aligned', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    const headerCell = screen.getAllByRole('columnheader')[0]
    expect(headerCell).toBeDefined()
    expect(headerCell?.className).toContain('whitespace-normal')

    const bodyCell = screen.getAllByRole('cell')[0]
    expect(bodyCell).toBeDefined()
    expect(bodyCell?.className).toContain('align-top')
  })

  it('the practice legend keys the frame and the fill, not a blank swatch, for the planned bar', () => {
    const rows = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    expect(screen.getByText('Planned minutes')).toBeInTheDocument()
    expect(screen.getByText('Completed minutes')).toBeInTheDocument()

    const plannedSwatch = screen.getByTestId('legend-swatch-plannedMinutes')
    expect(plannedSwatch.style.borderStyle).toBe('solid')
    expect(plannedSwatch.style.backgroundColor).toBe('transparent')

    const completedSwatch = screen.getByTestId('legend-swatch-completedMinutes')
    expect(completedSwatch.style.backgroundColor).not.toBe('transparent')
    expect(completedSwatch.style.backgroundColor).not.toBe('')
  })

  it('the completed bar paints inside the planned frame, in the same x-slot (C-I1)', () => {
    const rows = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    // A fixed barSize with an equal-and-opposite barGap collapses Recharts'
    // default side-by-side grouping to zero, so the two same-category bars
    // occupy the identical rectangle instead of sitting beside each other.
    const captured = getCaptured()
    expect(captured.barChartBarSize).toBeDefined()
    expect(captured.barChartBarGap).toBe(-(captured.barChartBarSize as number))

    // Completed (filled) must render FIRST and planned (frame) SECOND, so the
    // frame's stroke paints on top of the fill and stays visible even when
    // completed minutes meet or exceed planned minutes.
    const bars = [...screen.getByTestId('mock-barchart').querySelectorAll('[data-testid^="bar-"]')].map((bar) =>
      bar.getAttribute('data-testid'),
    )
    expect(bars).toEqual(['bar-completedMinutes', 'bar-plannedMinutes'])
  })

  it('the practice bar keeps its historical width for a short fixture (F3)', () => {
    const rows = [
      makePracticeRow({ sessionId: 's1', day: 1, localDate: '2026-09-01', targetSeconds: 600, completedSeconds: 600 }),
      makePracticeRow({ sessionId: 's2', day: 2, localDate: '2026-09-02', targetSeconds: 600, completedSeconds: 600 }),
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    const captured = getCaptured()
    expect(captured.barChartBarSize).toBe(24)
    expect(captured.barChartBarGap).toBe(-24)
  })

  it('the practice bar shrinks below its cap for a full 14-day, two-block programme so bands never overlap (F3)', () => {
    // 28 blocks (14 days x 2 blocks/day) — the programme's end state that a
    // fixed 24px bar would overrun (F1 re-review Minor).
    const rows = Array.from({ length: 28 }, (_, i) =>
      makePracticeRow({
        sessionId: `s${i + 1}`,
        day: Math.floor(i / 2) + 1,
        localDate: `2026-09-${String(Math.floor(i / 2) + 1).padStart(2, '0')}`,
        targetSeconds: 600,
        completedSeconds: 600,
      }),
    )
    renderWithProviders(<PracticeTrend practice={rows} />)

    const captured = getCaptured()
    const barSize = captured.barChartBarSize as number
    // plotWidth = CHART_WIDTH (640) - Recharts' own default left/right margin
    // (5 + 5, since PracticeTrend's <BarChart> passes no `margin`) = 630;
    // floor((630 / 28) * 0.7) = floor(15.75) = 15.
    expect(barSize).toBe(15)
    expect(barSize).toBeLessThan(24)
    expect(barSize).toBeGreaterThanOrEqual(4)
    expect(captured.barChartBarGap).toBe(-barSize)
  })

  it('the daily chart tooltip paints item and label text in ink, never a series colour (C-I2)', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    const captured = getCaptured()
    expect(captured.tooltipItemStyle).toEqual({ color: '#16232B' })
    expect(captured.tooltipLabelStyle).toEqual({ color: '#16232B' })
  })

  it('daily trend legend renders label text in ink, never the series colour (Task V4)', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1 })]
    renderWithProviders(<DailyTrend days={days} />)

    const formatter = getCaptured().dailyLegendFormatter
    expect(formatter).toBeDefined()

    const rendered = formatter?.('Sleep') as { props?: { className?: string; children?: unknown } } | null
    expect(rendered).not.toBeNull()
    expect(rendered?.props?.className).toBe('text-ink')
    expect(rendered?.props?.children).toBe('Sleep')
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

describe('formatWholeMinutes (task V1)', () => {
  it('formats a whole minute value as-is, no rounding or dividing by sixty', () => {
    expect(formatWholeMinutes(420)).toBe('420')
  })

  it('renders an explicit 0 as the string "0", never coalesced away', () => {
    expect(formatWholeMinutes(0)).toBe('0')
  })

  it('renders null as Not reported', () => {
    expect(formatWholeMinutes(null)).toBe(NOT_REPORTED)
  })

  it('renders undefined as Not reported', () => {
    expect(formatWholeMinutes(undefined)).toBe(NOT_REPORTED)
  })
})
