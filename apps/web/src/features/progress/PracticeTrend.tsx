/**
 * The Progress report's practice trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx`. Pure presentation of
 * `report.practice` (`PracticeRowValue[]`, `packages/shared/src/contracts/
 * report.ts`, 6.2.4) — nothing here derives a score or a completion state
 * the server did not already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * practice blocks show per-day planned/completed durations, output quality
 * and per-block counts, with a note that durations vary — practice is never
 * compared against the fixed 20-minute benchmark. The bar chart is
 * `aria-hidden`; the `ExactValuesTable` beneath it is the accessible
 * equivalent.
 *
 * Every count column (S/E/agent checks/output quality/time source) renders
 * through `<Reported>`, never '0' for `null` (CLAUDE.md: unknown != zero).
 * Timer flag hits all three tiers on its own: 'OK' is recorded, 'Timing
 * uncertain' is the one uncertain-tier amber mark worth drawing the eye to,
 * 'Not reported' is absent — `Trends.test.tsx` exercises all three at this
 * exact column rather than assuming `<Reported>` gets it right by default.
 * `mono` is passed only to figure cells (day, date, block, planned/completed
 * minutes, S/E/agent-check counts) — never to output quality, timer flag or
 * time source, which are recorded WORDS, not figures (fix round 1, finding 2).
 *
 * The chart re-encodes planned-vs-completed as an unfilled ruled FRAME
 * (planned, stroke only, the `rule` hairline colour) drawn OVER a fill of
 * `ink` (completed) occupying the SAME x-slot — the same metaphor as the
 * not-a-value ruled slot, arriving independently at the other end of the app
 * (the rework spec §7, decision U12). Recharts groups same-category `<Bar>`s
 * side by side by default; a fixed `barSize` and an equal-and-opposite
 * `barGap` on `<BarChart>` (C-I1) collapse that gap to zero so the two bars
 * occupy the identical rectangle instead of sitting beside each other. The
 * completed (filled) `<Bar>` renders FIRST and the planned (frame) `<Bar>`
 * renders SECOND — SVG paints in document order, so the frame's stroke sits
 * on top of the fill and stays visible even when completed minutes meet or
 * exceed planned minutes. Both `<Bar>` elements keep their `dataKey`s
 * (`plannedMinutes`/`completedMinutes`) exactly, since `Trends.test.tsx`'s
 * own recharts mock keys its `bar-<dataKey>` test IDs off them.
 * `completedMinutes` stays `null` (never `0`) for a block that has not ended
 * yet, so an unfinished block draws an empty frame, never a zero-height bar.
 *
 * Recharts 3.10.1 builds a Bar's legend swatch from `fill` alone
 * (`cartesian/Bar.js`'s `computeLegendPayloadFromBarData`), so the planned
 * bar's `fill="none"` legend entry would otherwise render a blank swatch next
 * to its label — a key for only half of the frame-versus-fill encoding (fix
 * round 1, finding 1). `renderPracticeLegend` below replaces `<Legend>`'s
 * default content with two fixed entries that draw each key as what it
 * actually is: an unfilled frame for planned, a filled square for completed,
 * reusing this file's own `FRAME_COLOR`/`FILL_COLOR` so the legend can never
 * drift from what the bars themselves draw. The chart wrapper stays
 * `aria-hidden="true"`, so this legend (like the rest of the chart) is
 * decorative; `ExactValuesTable` remains the accessible source of the data.
 *
 * Recharts is deliberately used only in this feature directory (`no file
 * outside apps/web/src/features/progress imports recharts`, this file's own
 * grep test in `Trends.test.tsx`) — `ResponsiveContainer` is NOT used: it
 * requires `ResizeObserver` to ever report a non-zero size, which jsdom does
 * not implement, so this chart renders at a fixed pixel size inside an
 * `overflow-x-auto` wrapper instead.
 */
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import type { PracticeRowValue } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { Reported } from '../../ui/Reported.js'
import { ExactValuesTable, type ExactValuesTableRow } from './ExactValuesTable.js'
import { formatReportedCount } from './format.js'
import {
  blockOrdinals,
  formatCountMethod,
  formatMinutes,
  formatOutputQuality,
  formatTimerFlag,
  secondsToWholeMinutes,
} from './trendFormat.js'

// the rework spec §7, "The practice bar chart": planned is an unfilled ruled
// frame using the `rule` hairline token; completed fills that same frame
// with `ink`. Never a second categorical hue — planned-vs-completed is a
// target and an actual, not two unrelated series.
const FRAME_COLOR = '#D5DBDA' // rule
const FILL_COLOR = '#16232B' // ink
const AXIS_INK = '#455761' // ink-muted
const GRIDLINE = '#D5DBDA' // rule

const CHART_WIDTH = 640
const CHART_HEIGHT = 240

// A fixed bar width plus an equal-and-opposite `barGap` on `<BarChart>`
// overlays the two same-category bars instead of Recharts' default
// side-by-side grouping (C-I1) — see this file's header comment.
const BAR_SIZE = 24

const COLUMNS = [
  'Day',
  'Date',
  'Block',
  'Planned (min)',
  'Completed (min)',
  'Output quality',
  'S',
  'E',
  'Agent checks',
  'Timer flag',
  'Time source',
] as const

export interface PracticeTrendProps {
  readonly practice: readonly PracticeRowValue[]
}

interface PracticeChartDatum {
  readonly label: string
  readonly plannedMinutes: number
  // `null`, never `0`, for a block that has not ended yet — recharts simply
  // omits the bar for a `null` datum.
  readonly completedMinutes: number | null
}

/**
 * `<Legend>`'s `content` renderer (fix round 1, finding 1) — see this file's
 * header comment. Fixed to these two known series rather than derived from
 * Recharts' own payload: `payload[].color` is `fill`, which is `'none'` for
 * the planned bar, so a plain coloured-swatch default would draw a solid
 * grey square that misdescribes an unfilled frame. Ignores its `props`
 * argument entirely — assignable to Recharts' `LegendProps['content']`
 * (`ReactElement | ((props: Props) => ReactNode)`) because a function with
 * fewer parameters is always assignable to one that takes more.
 */
function renderPracticeLegend(): ReactNode {
  return (
    <ul className="m-0 flex list-none items-center justify-center gap-4 p-0 text-xs text-ink-muted">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          data-testid="legend-swatch-plannedMinutes"
          className="inline-block h-3 w-3"
          style={{ border: `1.5px solid ${FRAME_COLOR}`, backgroundColor: 'transparent' }}
        />
        Planned minutes
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          data-testid="legend-swatch-completedMinutes"
          className="inline-block h-3 w-3"
          style={{ backgroundColor: FILL_COLOR }}
        />
        Completed minutes
      </li>
    </ul>
  )
}

export function PracticeTrend({ practice }: PracticeTrendProps) {
  const reducedMotion = usePrefersReducedMotion()
  const blocks = blockOrdinals(practice)

  const chartData: PracticeChartDatum[] = practice.map((row) => ({
    // A comma, not a middle dot: the rework spec §4 bans "meta strings joined with
    // middle dots" as a commonest tell of generated design. This axis label
    // is new content this task writes, not preserved legacy text, so it
    // must not introduce the pattern the rule names.
    label: `Day ${row.day}, Block ${blocks.get(row.sessionId) ?? 1}`,
    plannedMinutes: secondsToWholeMinutes(row.targetSeconds),
    completedMinutes: row.completedSeconds == null ? null : secondsToWholeMinutes(row.completedSeconds),
  }))

  const tableRows: ExactValuesTableRow[] = practice.map((row) => ({
    key: row.sessionId,
    cells: [
      <Reported key="day" mono>
        {String(row.day)}
      </Reported>,
      <Reported key="date" mono>
        {row.localDate}
      </Reported>,
      <Reported key="block" mono>
        {String(blocks.get(row.sessionId) ?? 1)}
      </Reported>,
      <Reported key="planned" mono>
        {String(secondsToWholeMinutes(row.targetSeconds))}
      </Reported>,
      <Reported key="completed" mono>
        {formatMinutes(row.completedSeconds)}
      </Reported>,
      <Reported key="quality">{formatOutputQuality(row.outputQuality)}</Reported>,
      <Reported key="s" mono>
        {formatReportedCount(row.episodeCount)}
      </Reported>,
      <Reported key="e" mono>
        {formatReportedCount(row.externalCount)}
      </Reported>,
      <Reported key="agent" mono>
        {formatReportedCount(row.unplannedAgentChecks)}
      </Reported>,
      <Reported key="timer">{formatTimerFlag(row.timerQuality)}</Reported>,
      <Reported key="method">{formatCountMethod(row.countMethod)}</Reported>,
    ],
  }))

  return (
    <section className="flex flex-col gap-3" aria-labelledby="practice-trend-heading">
      <h2 id="practice-trend-heading" className="text-base font-semibold">
        Practice
      </h2>
      <p className="text-sm text-ink-muted">
        Durations vary by design; practice blocks are never compared with the fixed 20-minute benchmark.
      </p>

      {chartData.length > 0 ? (
        <div aria-hidden="true" data-testid="practice-trend-chart" className="overflow-x-auto">
          {/* See DailyTrend.tsx's identical comment: Recharts' root `<svg>`
              defaults to `tabindex="0"`, which — inside this
              `aria-hidden="true"` wrapper — is a Tab stop with no announced
              content (axe's "aria-hidden-focus", WCAG 4.1.2). */}
          <BarChart
            width={CHART_WIDTH}
            height={CHART_HEIGHT}
            data={chartData}
            tabIndex={-1}
            barSize={BAR_SIZE}
            barGap={-BAR_SIZE}
          >
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_INK, fontSize: 11 }} />
            <YAxis
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: AXIS_INK }}
            />
            <Tooltip />
            <Legend content={renderPracticeLegend} />
            {/* Completed (filled) renders FIRST, planned (frame) SECOND: SVG
                paints in document order, so the frame's stroke stays visible
                on top of the fill even when completed >= planned. */}
            <Bar
              dataKey="completedMinutes"
              name="Completed minutes"
              fill={FILL_COLOR}
              radius={0}
              isAnimationActive={!reducedMotion}
            />
            <Bar
              dataKey="plannedMinutes"
              name="Planned minutes"
              fill="none"
              stroke={FRAME_COLOR}
              strokeWidth={1.5}
              radius={0}
              isAnimationActive={!reducedMotion}
            />
          </BarChart>
        </div>
      ) : null}

      <ExactValuesTable
        caption="Practice blocks"
        columns={COLUMNS}
        rows={tableRows}
        emptyMessage="No practice blocks yet."
      />
      <p className="text-xs text-ink-muted">Practice durations and counts are self-reported.</p>
    </section>
  )
}
