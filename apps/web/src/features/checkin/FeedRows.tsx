/**
 * Feed detail rows and optional fields inside CheckinForm's "More detail"
 * Collapsible (task 8.7.2; design.md D36; specs/daily-checkin).
 *
 * A detail row's `platform === 'all'` is reserved for the 8.7.1 headline
 * total (D36) — never accepted from this component — and the whole-row
 * uniqueness / short-video-subset rules mirror `packages/shared`
 * `domain/feed.ts`'s `validateFeedRows` (D4: the domain module is the one
 * place those rules are defined; this file only re-checks the same
 * conditions inline so Save can be blocked and the offending row named
 * before a round trip to the server, and reuses `feedAggregates` — never its
 * own arithmetic — for every total FeedTotals.tsx shows).
 *
 * A row is a `FeedRowDraft`, not a wire `FeedRowValue`: `minutes` and
 * `shortVideoMinutes` may be blank (`null`) while a row is still being
 * filled in — the wire shape only exists once a row is complete
 * (`sendableDetailRow`). This keeps "all numeric inputs start blank" true
 * for detail rows the same way it already is for the 8.7.1 headline fields,
 * and never coerces an unfinished row into a zero-value one (CLAUDE.md
 * "Unknown != zero").
 */
import {
  FEED_DEVICES,
  FEED_PLATFORM_ALL,
  type FeedDevice,
  type FeedRowInput,
  type FeedRowValue,
  type FeedSource,
  type MeasurementScope,
} from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedRowDraft {
  readonly device: FeedDevice
  readonly platform: string
  readonly minutes: number | null
  readonly shortVideoMinutes: number | null
  readonly measurementScope: MeasurementScope
  readonly source: FeedSource
  readonly plannedWindow: boolean | null
}

export interface FeedRowFieldErrors {
  readonly platform?: string
  readonly shortVideoMinutes?: string
  /** A whole-row (rather than single-field) message — a server 422 `feed_platform_conflict` or `duplicate_feed_row` naming this row. */
  readonly row?: string
}

/** Keyed by the row's index in the `rows` array passed to `FeedRows`/`validateDetailRows`. */
export type FeedRowsErrors = Readonly<Record<number, FeedRowFieldErrors>>

export interface FeedRowsProps {
  readonly rows: readonly FeedRowDraft[]
  readonly onChange: (rows: readonly FeedRowDraft[]) => void
  readonly errors?: FeedRowsErrors
}

// ---------------------------------------------------------------------------
// Conversions (D36 wiring between the draft shape and the wire FeedRowValue)
// ---------------------------------------------------------------------------

/** Mirrors `apps/api`'s `normalizeFeedRow` (services/checkin.ts): the wire shape's optional fields, always present. */
export function toFeedRowInput(row: FeedRowValue): FeedRowInput {
  return {
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes ?? null,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow ?? null,
  }
}

/** Widens a loaded/saved row to the editable draft shape (`minutes` becomes nullable, structurally unchanged otherwise). */
export function toDraftRow(row: FeedRowValue): FeedRowDraft {
  return {
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes ?? null,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow ?? null,
  }
}

export function emptyDraftRow(device: FeedDevice = 'phone'): FeedRowDraft {
  return {
    device,
    platform: '',
    minutes: null,
    shortVideoMinutes: null,
    measurementScope: 'feed',
    source: 'estimate',
    plannedWindow: null,
  }
}

/**
 * `null` when the row is not yet complete (blank platform, `'all'` typed as
 * the platform, or blank minutes) — an incomplete row is simply never sent,
 * the same way leaving the 8.7.1 headline fields blank sends nothing; it is
 * never coerced into a zero-value row.
 */
export function sendableDetailRow(row: FeedRowDraft): FeedRowValue | null {
  const platform = row.platform.trim()
  if (platform === '' || platform.toLowerCase() === FEED_PLATFORM_ALL || row.minutes === null) return null
  return {
    device: row.device,
    platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
  }
}

// ---------------------------------------------------------------------------
// Validation (client-side pre-check; the server's `validateFeedRows` is
// still the authority — see this file's header comment)
// ---------------------------------------------------------------------------

export const SUBSET_VIOLATION_MESSAGE = 'Short video is a subset of feed minutes and cannot exceed them'
export const PLATFORM_ALL_RESERVED_MESSAGE = '"All" is reserved for the total above; name the platform instead'
export const PLATFORM_REQUIRED_MESSAGE = 'Platform is required'
export const DUPLICATE_ROW_MESSAGE = 'This device, platform and scope was already reported for this day'

/** Every offending row, by index — a row with no issue is simply absent from the result. */
export function validateDetailRows(rows: readonly FeedRowDraft[]): FeedRowsErrors {
  const errors: Record<number, FeedRowFieldErrors> = {}
  const seen = new Map<string, number>()

  rows.forEach((row, index) => {
    const platform = row.platform.trim()
    const fieldErrors: { platform?: string; shortVideoMinutes?: string } = {}

    if (platform.toLowerCase() === FEED_PLATFORM_ALL) {
      fieldErrors.platform = PLATFORM_ALL_RESERVED_MESSAGE
    } else if (platform === '' && row.minutes !== null) {
      fieldErrors.platform = PLATFORM_REQUIRED_MESSAGE
    }

    if (row.shortVideoMinutes !== null && row.minutes !== null && row.shortVideoMinutes > row.minutes) {
      fieldErrors.shortVideoMinutes = SUBSET_VIOLATION_MESSAGE
    }

    if (Object.keys(fieldErrors).length > 0) {
      errors[index] = fieldErrors
    }

    if (platform !== '' && platform.toLowerCase() !== FEED_PLATFORM_ALL) {
      const key = `${row.device}\0${platform}\0${row.measurementScope}`
      const firstIndex = seen.get(key)
      if (firstIndex !== undefined) {
        errors[index] = { ...errors[index], row: DUPLICATE_ROW_MESSAGE }
      } else {
        seen.set(key, index)
      }
    }
  })

  return errors
}

/** Whether any entry would block Save — a whole-row (`row`) message from a duplicate always blocks; per-field messages always block. */
export function hasBlockingDetailRowErrors(errors: FeedRowsErrors): boolean {
  return Object.values(errors).some(
    (entry) => entry.platform !== undefined || entry.shortVideoMinutes !== undefined || entry.row !== undefined,
  )
}

function mergeRowErrors(a: FeedRowsErrors, b: FeedRowsErrors | undefined): FeedRowsErrors {
  if (b === undefined) return a
  const merged: Record<number, FeedRowFieldErrors> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const index = Number(key)
    merged[index] = { ...a[index], ...b[index] }
  }
  return merged
}

export const STRESS_RANGE_MESSAGE = 'Stress must be a whole number from 0 to 10'
export const MINDFULNESS_RANGE_MESSAGE = 'Mindfulness minutes must be 0 or greater'

export function validateStress(value: number | null): string | undefined {
  if (value === null) return undefined
  return !Number.isInteger(value) || value < 0 || value > 10 ? STRESS_RANGE_MESSAGE : undefined
}

export function validateMindfulnessMinutes(value: number | null): string | undefined {
  if (value === null) return undefined
  return !Number.isInteger(value) || value < 0 ? MINDFULNESS_RANGE_MESSAGE : undefined
}

// ---------------------------------------------------------------------------
// FeedRow / FeedRows
// ---------------------------------------------------------------------------

const DEVICE_LABEL: Record<FeedDevice, string> = {
  phone: 'Phone',
  desktop: 'Desktop',
  tablet: 'Tablet',
  unspecified: 'Unspecified',
}

/** Accepts blank (-> `null`) or a non-negative integer; rejects any other keystroke outright (mirrors DeviceMinutesField). */
function parseOptionalNonNegativeInteger(raw: string): number | null | undefined {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

interface FeedRowProps {
  readonly index: number
  readonly row: FeedRowDraft
  readonly errors: FeedRowFieldErrors | undefined
  readonly onChange: (row: FeedRowDraft) => void
  readonly onRemove: () => void
}

function FeedRow({ index, row, errors, onChange, onRemove }: FeedRowProps) {
  const idBase = `feedrow-${index}`

  function patch(next: Partial<FeedRowDraft>): void {
    onChange({ ...row, ...next })
  }

  return (
    <div role="group" aria-label={`Feed detail row ${index + 1}`} className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
      {errors?.row !== undefined ? (
        <p role="alert" className="text-sm text-red-700">
          {errors.row}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-device`} className="text-sm font-medium text-[var(--color-text)]">
          Device
        </label>
        <select
          id={`${idBase}-device`}
          value={row.device}
          onChange={(event) => patch({ device: event.target.value as FeedDevice })}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          {FEED_DEVICES.map((device) => (
            <option key={device} value={device}>
              {DEVICE_LABEL[device]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-platform`} className="text-sm font-medium text-[var(--color-text)]">
          Platform
        </label>
        <input
          id={`${idBase}-platform`}
          type="text"
          value={row.platform}
          onChange={(event) => patch({ platform: event.target.value })}
          className="min-h-11 w-full max-w-60 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {errors?.platform !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {errors.platform}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-minutes`} className="text-sm font-medium text-[var(--color-text)]">
          Minutes
        </label>
        <input
          id={`${idBase}-minutes`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={row.minutes === null ? '' : row.minutes}
          onChange={(event) => {
            const next = parseOptionalNonNegativeInteger(event.target.value)
            if (next === undefined) return
            patch({ minutes: next })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-shortvideo`} className="text-sm font-medium text-[var(--color-text)]">
          Short-video minutes
        </label>
        <input
          id={`${idBase}-shortvideo`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={row.shortVideoMinutes === null ? '' : row.shortVideoMinutes}
          onChange={(event) => {
            const next = parseOptionalNonNegativeInteger(event.target.value)
            if (next === undefined) return
            patch({ shortVideoMinutes: next })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {errors?.shortVideoMinutes !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {errors.shortVideoMinutes}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-[var(--color-text)]">Measurement scope</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="radio"
              name={`${idBase}-scope`}
              checked={row.measurementScope === 'feed'}
              onChange={() => patch({ measurementScope: 'feed' })}
            />
            Feed only
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="radio"
              name={`${idBase}-scope`}
              checked={row.measurementScope === 'app_total'}
              onChange={() => patch({ measurementScope: 'app_total' })}
            />
            Whole app
          </label>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
        <input
          type="checkbox"
          checked={row.source === 'device_report'}
          onChange={(event) => patch({ source: event.target.checked ? 'device_report' : 'estimate' })}
        />
        From device report
      </label>

      <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
        <input
          type="checkbox"
          checked={row.plannedWindow === true}
          onChange={(event) => patch({ plannedWindow: event.target.checked ? true : null })}
        />
        Planned window
      </label>

      <Button type="button" variant="secondary" onClick={onRemove}>
        Remove row
      </Button>
    </div>
  )
}

export function FeedRows({ rows, onChange, errors }: FeedRowsProps) {
  const merged = mergeRowErrors(validateDetailRows(rows), errors)

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => (
        <FeedRow
          key={index}
          index={index}
          row={row}
          errors={merged[index]}
          onChange={(next) => onChange(rows.map((existing, i) => (i === index ? next : existing)))}
          onRemove={() => onChange(rows.filter((_, i) => i !== index))}
        />
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange([...rows, emptyDraftRow()])}>
        Add row
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OptionalFields
// ---------------------------------------------------------------------------

export interface OptionalFieldsValue {
  readonly stress: number | null
  readonly mindfulnessMinutes: number | null
  readonly note: string
}

export interface OptionalFieldsProps extends OptionalFieldsValue {
  readonly onChange: (patch: Partial<OptionalFieldsValue>) => void
}

/** Blank sign-integer parse for stress/mindfulness: unlike the row minutes fields, an out-of-range value is accepted (so it can be shown as an inline error) rather than rejected at the keystroke. */
function parseBlankableInteger(raw: string): number | null | undefined {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : undefined
}

export function OptionalFields({ stress, mindfulnessMinutes, note, onChange }: OptionalFieldsProps) {
  const stressMessage = validateStress(stress)
  const mindfulnessMessage = validateMindfulnessMinutes(mindfulnessMinutes)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="checkin-stress" className="text-sm font-medium text-[var(--color-text)]">
          Stress (0-10)
        </label>
        <input
          id="checkin-stress"
          type="number"
          inputMode="numeric"
          step={1}
          value={stress === null ? '' : stress}
          onChange={(event) => {
            const next = parseBlankableInteger(event.target.value)
            if (next === undefined) return
            onChange({ stress: next })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {stressMessage !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {stressMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="checkin-mindfulness" className="text-sm font-medium text-[var(--color-text)]">
          Mindfulness minutes
        </label>
        <input
          id="checkin-mindfulness"
          type="number"
          inputMode="numeric"
          step={1}
          value={mindfulnessMinutes === null ? '' : mindfulnessMinutes}
          onChange={(event) => {
            const next = parseBlankableInteger(event.target.value)
            if (next === undefined) return
            onChange({ mindfulnessMinutes: next })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {mindfulnessMessage !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {mindfulnessMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="checkin-note" className="text-sm font-medium text-[var(--color-text)]">
          Note
        </label>
        <textarea
          id="checkin-note"
          value={note}
          onChange={(event) => onChange({ note: event.target.value })}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
      </div>
    </div>
  )
}
