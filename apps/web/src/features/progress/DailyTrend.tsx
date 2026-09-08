/**
 * The Progress report's daily trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx` (8.8.1's TODO slot — see this
 * task's `centralWiringNeeded`). Pure presentation of `report.days`
 * (`DayRowValue[]`, `packages/shared/src/contracts/report.ts`, 6.2.4) —
 * nothing here derives a value the server did not already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * daily check-ins show sleep and feed minutes by device; a day with no
 * check-in row at all is a gap ('Not reported'), never a zero
 * (daily-checkin: "Overruns and missed days never block" / "Skipped day").
 * The line chart is `aria-hidden` with `connectNulls={false}` so a missing
 * day is a genuine break in the line, never bridged or read as zero; the
 * `ExactValuesTable` beneath it is the accessible equivalent
 * (progress-report: "Charts carry exact values").
 *
 * `report.days`'s `DayRowValue` (owned by task 6.2, already complete/
 * verified — this task does not touch `packages/shared` or `apps/api`)
 * exposes only `feedByDevice`, the per-device MINUTE TOTAL summed across
 * every scope-`feed` row for that day (`services/report/days.ts`'s
 * `mapDayRow` -> `domain/feed.ts`'s `feedAggregates`) — the raw per-row
 * `platform`/`source` detail the check-in form itself captures
 * (`contracts/days.ts`'s `FeedRowSchema`) is reduced away before it reaches
 * this report and this task adds no additional request to recover it (its
 * own brief: "no additional requests"). So this table shows device totals
 * (each explicitly labelled 'device-minutes', `domain/feed.ts`'s
 * `FeedAggregates.unitLabel`) rather than attributing an 'Estimate'/'From
 * device report' source to any specific number, and instead carries a
 * general provenance note naming both sources — see the note below the
 * table. Widening `DayRowSchema` to carry per-row feed detail is a backend
 * follow-up outside this frontend-only task's file ownership; flagged in
 * this task's own report for a reviewer.
 */
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayRowValue, FeedDevice } from '@attention-lab/shared'
import { FEED_DEVICES } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { ExactValuesTable, type ExactValuesTableRow } from './ExactValuesTable.js'
import { FEED_SOURCE_LABEL, formatCheckinStatus, formatFeedDevice, formatMinutes } from './trendFormat.js'

// See PracticeTrend.tsx's header comment for why fixed pixel dimensions (no
// `ResponsiveContainer`) and this feature-local color use.
const SLEEP_COLOR = '#2a78d6'
const DEVICE_COLOR: Record<FeedDevice, string> = {
  phone: '#eb6834',
  desktop: '#1baf7a',
  tablet: '#eda100',
  unspecified: '#e87ba4',
}
const AXIS_INK = '#898781'
const GRIDLINE = '#e1e0d9'

const CHART_WIDTH = 640
const CHART_HEIGHT = 240

const COLUMNS = [
  'Day',
  'Date',
  'Status',
  'Sleep (min)',
  'Mindfulness (min)',
  'Stress',
  'Phone (device-minutes)',
  'Desktop (device-minutes)',
  'Tablet (device-minutes)',
  'Unspecified device (device-minutes)',
  'Feed total (device-minutes)',
] as const

export interface DailyTrendProps {
  readonly days: readonly DayRowValue[]
}

interface DailyChartDatum {
  readonly day: number
  // Every field is `null`, never `0`, for a day with no reported value —
  // `connectNulls={false}` on each `Line` renders that as a real gap.
  readonly sleepMinutes: number | null
  readonly phoneMinutes: number | null
  readonly desktopMinutes: number | null
  readonly tabletMinutes: number | null
  readonly unspecifiedMinutes: number | null
}

export function DailyTrend({ days }: DailyTrendProps) {
  const reducedMotion = usePrefersReducedMotion()

  const chartData: DailyChartDatum[] = days.map((day) => ({
    day: day.day,
    sleepMinutes: day.sleepMinutes,
    phoneMinutes: day.feedByDevice.phone,
    desktopMinutes: day.feedByDevice.desktop,
    tabletMinutes: day.feedByDevice.tablet,
    unspecifiedMinutes: day.feedByDevice.unspecified,
  }))

  const tableRows: ExactValuesTableRow[] = days.map((day) => ({
    key: day.localDate,
    cells: [
      day.day,
      day.localDate,
      formatCheckinStatus(day.status),
      formatMinutes(day.sleepMinutes),
      formatMinutes(day.mindfulnessMinutes),
      day.stress === null ? 'Not reported' : day.stress,
      formatMinutes(day.feedByDevice.phone),
      formatMinutes(day.feedByDevice.desktop),
      formatMinutes(day.feedByDevice.tablet),
      formatMinutes(day.feedByDevice.unspecified),
      formatMinutes(day.feedDeviceMinutes),
    ],
  }))

  return (
    <section className="flex flex-col gap-3" aria-labelledby="daily-trend-heading">
      <h2 id="daily-trend-heading" className="text-base font-semibold">
        Daily check-ins
      </h2>

      {chartData.length > 0 ? (
        <div aria-hidden="true" data-testid="daily-trend-chart" className="overflow-x-auto">
          {/* `tabIndex={-1}`: Recharts renders its root `<svg>` with
              `tabindex="0"` by default (its own built-in keyboard
              affordance) — inside this `aria-hidden="true"` wrapper, that
              gives Tab a stop with no announced content at all (axe's
              "aria-hidden-focus", WCAG 4.1.2). The `ExactValuesTable` below
              is this data's real, focusable, accessible form. */}
          <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={chartData} tabIndex={-1}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={(value: number) => `Day ${value}`}
              tick={{ fill: AXIS_INK, fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: AXIS_INK }}
            />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="sleepMinutes"
              name="Sleep"
              stroke={SLEEP_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
            {FEED_DEVICES.map((device) => (
              <Line
                key={device}
                type="monotone"
                dataKey={`${device}Minutes`}
                name={`${formatFeedDevice(device)} feed`}
                stroke={DEVICE_COLOR[device]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </LineChart>
        </div>
      ) : null}

      <ExactValuesTable
        caption="Daily check-ins"
        columns={COLUMNS}
        rows={tableRows}
        emptyMessage="No daily check-ins yet."
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Feed minutes are recorded either as a quick {FEED_SOURCE_LABEL.estimate} or transcribed{' '}
        {FEED_SOURCE_LABEL.device_report}; the totals above combine both. Daily values are self-reported.
      </p>
    </section>
  )
}
