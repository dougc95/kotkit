/**
 * The Progress report's practice trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx` (8.8.1's TODO slot —
 * see this task's `centralWiringNeeded`). Pure presentation of
 * `report.practice` (`PracticeRowValue[]`, `packages/shared/src/contracts/
 * report.ts`, 6.2.4) — nothing here derives a score or a completion state
 * the server did not already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * practice blocks show per-day planned/completed durations, output quality
 * and per-block counts, with a note that durations vary — practice is never
 * compared against the fixed 20-minute benchmark (practice-sessions:
 * "Practice metrics stay separate from benchmarks"). The bar chart is
 * `aria-hidden`; the `ExactValuesTable` beneath it is the accessible
 * equivalent (progress-report: "Charts carry exact values").
 *
 * Every count column (S/E/agent checks) renders 'Not reported' for `null`,
 * never '0' (CLAUDE.md: unknown != zero) — see `trendFormat.ts`'s
 * `formatMinutes`/`formatOutputQuality`/`formatTimerFlag`/`formatCountMethod`.
 *
 * Recharts is deliberately used only in this feature directory (this task's
 * own named test: "no file outside apps/web/src/features/progress imports
 * recharts") — `ResponsiveContainer` is NOT used: it requires
 * `ResizeObserver` to ever report a non-zero size, which jsdom does not
 * implement (recharts silently renders nothing without it, per its own
 * `typeof ResizeObserver === 'undefined'` guard), so both charts in this
 * feature render at a fixed pixel size inside an `overflow-x-auto` wrapper
 * instead — the same horizontal-scroll pattern `AttemptTable`/
 * `ExactValuesTable` already use for their own wide tables.
 */
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import type { PracticeRowValue } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
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

// The dataviz skill's validated default categorical palette (references/
// palette.md), slots 1 and 2 — this app has one (light-only) surface today,
// so only the light steps are needed.
const PLANNED_COLOR = '#2a78d6'
const COMPLETED_COLOR = '#eb6834'
const AXIS_INK = '#898781'
const GRIDLINE = '#e1e0d9'

const CHART_WIDTH = 640
const CHART_HEIGHT = 240

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
  // `null`, never `0`, for a block that has not ended yet (`completedSeconds`
  // is `null` for a running/abandoned session — `services/report/
  // practice.ts`) — recharts simply omits the bar for a `null` datum.
  readonly completedMinutes: number | null
}

export function PracticeTrend({ practice }: PracticeTrendProps) {
  const reducedMotion = usePrefersReducedMotion()
  const blocks = blockOrdinals(practice)

  const chartData: PracticeChartDatum[] = practice.map((row) => ({
    label: `Day ${row.day} · Block ${blocks.get(row.sessionId) ?? 1}`,
    plannedMinutes: secondsToWholeMinutes(row.targetSeconds),
    completedMinutes: row.completedSeconds == null ? null : secondsToWholeMinutes(row.completedSeconds),
  }))

  const tableRows: ExactValuesTableRow[] = practice.map((row) => ({
    key: row.sessionId,
    cells: [
      row.day,
      row.localDate,
      blocks.get(row.sessionId) ?? 1,
      secondsToWholeMinutes(row.targetSeconds),
      formatMinutes(row.completedSeconds),
      formatOutputQuality(row.outputQuality),
      formatReportedCount(row.episodeCount),
      formatReportedCount(row.externalCount),
      formatReportedCount(row.unplannedAgentChecks),
      formatTimerFlag(row.timerQuality),
      formatCountMethod(row.countMethod),
    ],
  }))

  return (
    <section className="flex flex-col gap-3" aria-labelledby="practice-trend-heading">
      <h2 id="practice-trend-heading" className="text-base font-semibold">
        Practice
      </h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Durations vary by design; practice blocks are never compared with the fixed 20-minute benchmark.
      </p>

      {chartData.length > 0 ? (
        <div aria-hidden="true" data-testid="practice-trend-chart" className="overflow-x-auto">
          <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={chartData}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_INK, fontSize: 11 }} />
            <YAxis
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: AXIS_INK }}
            />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="plannedMinutes"
              name="Planned minutes"
              fill={PLANNED_COLOR}
              radius={[4, 4, 0, 0]}
              isAnimationActive={!reducedMotion}
            />
            <Bar
              dataKey="completedMinutes"
              name="Completed minutes"
              fill={COMPLETED_COLOR}
              radius={[4, 4, 0, 0]}
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
      <p className="text-xs text-[var(--color-text-muted)]">Practice durations and counts are self-reported.</p>
    </section>
  )
}
