/**
 * The Progress report's daily trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx`. Pure presentation of
 * `report.days` (`DayRowValue[]`, `packages/shared/src/contracts/
 * report.ts`, 6.2.4) — nothing here derives a value the server did not
 * already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * daily check-ins show sleep and feed minutes by device; a day with no
 * check-in row at all is a gap ('Not reported'), never a zero. The line
 * chart is `aria-hidden` with `connectNulls={false}` so a missing day is a
 * genuine break in the line, never bridged or read as zero; the
 * `ExactValuesTable` beneath it is the accessible equivalent.
 *
 * Every table cell (status, sleep/mindfulness/feed minutes, stress) renders
 * through `<Reported>` — including stress, which now always formats to a
 * string via `trendFormat.ts`'s `formatStress` instead of the previous
 * inline `day.stress === null ? 'Not reported' : day.stress` (the rework spec §9,
 * defect 5), so it can carry the same tier mark as every other cell instead
 * of rendering as a bare, untiered number.
 *
 * `report.days`'s `DayRowValue` exposes only `feedByDevice`, the per-device
 * MINUTE TOTAL summed across every scope-`feed` row for that day
 * (`services/report/days.ts`'s `mapDayRow` -> `domain/feed.ts`'s
 * `feedAggregates`) — the raw per-row `platform`/`source` detail the
 * check-in form itself captures is reduced away before it reaches this
 * report. So this table shows device totals (each explicitly labelled
 * 'device-minutes') rather than attributing an 'Estimate'/'From device
 * report' source to any specific number, and instead carries a general
 * provenance note naming both sources below the table.
 *
 * Chart palette: sleep keeps its original hue; the four feed-device colours
 * are re-stepped off the app's own `signal`/`attention` tokens so no chart
 * hue collides with what those tokens mean elsewhere (the rework spec §7) — the
 * old tablet yellow in particular sat right beside `attention`'s amber,
 * which would have meant "uncertain" in the interface and "tablet" in a
 * chart three inches away. Grid moves to the `rule` token, axis ticks to
 * `ink-muted`.
 */
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayRowValue, FeedDevice } from '@attention-lab/shared'
import { FEED_DEVICES } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { Reported } from '../../ui/Reported.js'
import { ExactValuesTable, type ExactValuesTableRow } from './ExactValuesTable.js'
import {
  FEED_SOURCE_LABEL,
  formatCheckinStatus,
  formatFeedDevice,
  formatMinutes,
  formatStress,
} from './trendFormat.js'

const SLEEP_COLOR = '#2a78d6'
const DEVICE_COLOR: Record<FeedDevice, string> = {
  phone: '#C24E1F',
  desktop: '#157F5C',
  tablet: '#4a3aa7',
  unspecified: '#C85480',
}
const AXIS_INK = '#455761' // ink-muted
const GRIDLINE = '#D5DBDA' // rule

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
      <Reported key="status">{formatCheckinStatus(day.status)}</Reported>,
      <Reported key="sleep">{formatMinutes(day.sleepMinutes)}</Reported>,
      <Reported key="mindfulness">{formatMinutes(day.mindfulnessMinutes)}</Reported>,
      <Reported key="stress">{formatStress(day.stress)}</Reported>,
      <Reported key="phone">{formatMinutes(day.feedByDevice.phone)}</Reported>,
      <Reported key="desktop">{formatMinutes(day.feedByDevice.desktop)}</Reported>,
      <Reported key="tablet">{formatMinutes(day.feedByDevice.tablet)}</Reported>,
      <Reported key="unspecified">{formatMinutes(day.feedByDevice.unspecified)}</Reported>,
      <Reported key="total">{formatMinutes(day.feedDeviceMinutes)}</Reported>,
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
              `tabindex="0"` by default — inside this `aria-hidden="true"`
              wrapper, that gives Tab a stop with no announced content at
              all (axe's "aria-hidden-focus", WCAG 4.1.2). The
              `ExactValuesTable` below is this data's real, focusable,
              accessible form. */}
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
      <p className="text-xs text-ink-muted">
        Feed minutes are recorded either as a quick {FEED_SOURCE_LABEL.estimate} or transcribed{' '}
        {FEED_SOURCE_LABEL.device_report}; the totals above combine both. Daily values are self-reported.
      </p>
    </section>
  )
}
