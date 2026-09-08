/**
 * Task 6.3.1 — renders an `ExportModel` (`./model.js`) as RFC 4180 CSV.
 *
 * `buildCsv` is a pure function over the already-assembled model: it never
 * touches the database, never re-derives a measurement and never reads
 * `ctx` directly — the demo label decision reads `model.program.realm`,
 * which `buildExportModel` already set to the same value `assertSameRealm`
 * proved every row shares (identity-realm "Demo mode is permanently and
 * unmistakably labeled" / "Export carries the demo label").
 *
 * Layout: an optional demo-label line, then five sections in fixed order
 * (`program`, `revisions`, `attempts`, `days`, `feed_rows`), each introduced
 * by a `# <name>` line, its header row, and its data rows — sections
 * separated by one blank line. Every free-text field the PRD ever collects
 * (`note`, `output_note`, `disruption_note`, recall points, `review_note`,
 * `intended_output`) is absent from `ExportModel` itself, so there is
 * nothing here that could leak it even by accident — this module maps named
 * fields one at a time, never a generic "every property of the row" dump.
 *
 * The header arrays and the per-row `string[]` mappers below are exported so
 * `markdown.ts` (6.3.2) renders the identical set of columns and the
 * identical cell text for every field — only the final assembly into text
 * (comma-and-quote here, a pipe table there) differs between the two
 * formats (D16: one owner of "which columns, which cell text").
 */
import {
  exportFirstSwitchSeconds,
  exportFirstSwitchState,
  type ExportAttemptRow,
  type ExportDayRow,
  type ExportFeedRow,
  type ExportModel,
  type ExportProgramRow,
  type ExportRevisionRow,
} from './model.js'

/** The exact literal, per task 6.3.1 — reused verbatim by `markdown.ts` (6.3.2). */
export const EXPORT_DEMO_LABEL =
  'Demonstration data — synthetic local-demo records, not a real measurement'

// ---------------------------------------------------------------------------
// RFC 4180 field/row/section primitives
// ---------------------------------------------------------------------------

/** A field is quoted only when it contains a comma, a double quote, or a line break; `"` doubles inside quotes. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',')
}

function csvSection(name: string, header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [`# ${name}`, csvRow(header), ...rows.map(csvRow)]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Blank-rule cell formatters (D7.1: null -> '', 0 -> '0', never 0 for null)
// ---------------------------------------------------------------------------

/** A `ReportedCount` (or any nullable number) cell: `null` -> `''`, otherwise the plain digits — `0` stays `'0'`. */
function numberCell(value: number | null): string {
  return value === null ? '' : String(value)
}

/** A nullable plain-string cell (method, condition field, replacement reason): `null` -> `''`. */
function stringCell(value: string | null): string {
  return value === null ? '' : value
}

/** `disruption`/`planned_window`: a nullable boolean rendered as the human words the PRD's own review screen uses. */
function yesNoCell(value: boolean | null): string {
  if (value === null) return ''
  return value ? 'yes' : 'no'
}

/** `eligible`: always a real boolean (never `null` on a benchmark attempt, D7.5) — no blank case to cover. */
function boolCell(value: boolean): string {
  return String(value)
}

function joinedCell(values: readonly string[]): string {
  return values.join(';')
}

// ---------------------------------------------------------------------------
// Section headers and row mappers
// ---------------------------------------------------------------------------

export const PROGRAM_HEADER = [
  'program_id',
  'realm',
  'identity_mode',
  'baseline_date',
  'timezone',
  'status',
  'leisure_allowance_min',
  'feed_estimate_min',
  'exported_at',
] as const

export function programRow(row: ExportProgramRow): string[] {
  return [
    row.programId,
    row.realm,
    row.identityMode,
    row.baselineDate,
    row.timezone,
    row.status,
    String(row.leisureAllowanceMin),
    numberCell(row.feedEstimateMin),
    row.exportedAt,
  ]
}

export const REVISIONS_HEADER = [
  'revision',
  'effective_day',
  'practice_target_seconds',
  'band_ceilings',
  'leisure_allowance_min',
  'reason',
  'created_at',
] as const

export function revisionRow(row: ExportRevisionRow): string[] {
  return [
    String(row.revision),
    String(row.effectiveDay),
    String(row.practiceTargetSeconds),
    JSON.stringify(row.bandCeilings),
    String(row.leisureAllowanceMin),
    row.reason,
    row.createdAt,
  ]
}

export const ATTEMPTS_HEADER = [
  'attempt_id',
  'phase',
  'label',
  'local_date',
  'realm',
  'time_source',
  's',
  's_method',
  't_state',
  't_seconds',
  't_method',
  'recall_score',
  'e',
  'm',
  'disruption',
  'device_format',
  'language',
  'material_level',
  'accommodations',
  'eligible',
  'exclusion_reasons',
  'protocol_revision',
  'recall_flags',
  'replacement_reason',
  'lifecycle',
] as const

export function attemptRow(row: ExportAttemptRow): string[] {
  return [
    row.attemptId,
    row.phase,
    row.label,
    row.localDate,
    row.realm,
    row.timeSource,
    numberCell(row.s),
    stringCell(row.sMethod),
    exportFirstSwitchState(row.firstSwitch),
    numberCell(exportFirstSwitchSeconds(row.firstSwitch)),
    stringCell(row.firstSwitchMethod),
    numberCell(row.recallScore),
    numberCell(row.e),
    numberCell(row.m),
    yesNoCell(row.disruption),
    stringCell(row.deviceFormat),
    stringCell(row.language),
    stringCell(row.materialLevel),
    joinedCell(row.accommodations),
    boolCell(row.eligible),
    joinedCell(row.exclusionReasons),
    String(row.protocolRevision),
    joinedCell(row.recallFlags),
    stringCell(row.replacementReason),
    row.lifecycle,
  ]
}

export const DAYS_HEADER = [
  'program_day',
  'local_date',
  'sleep_minutes',
  'stress',
  'mindfulness_minutes',
  'status',
] as const

export function dayRow(row: ExportDayRow): string[] {
  return [
    String(row.programDay),
    row.localDate,
    numberCell(row.sleepMinutes),
    numberCell(row.stress),
    numberCell(row.mindfulnessMinutes),
    row.status,
  ]
}

export const FEED_HEADER = [
  'local_date',
  'device',
  'platform',
  'minutes',
  'short_video_minutes',
  'measurement_scope',
  'source',
  'planned_window',
] as const

export function feedRow(row: ExportFeedRow): string[] {
  return [
    row.localDate,
    row.device,
    row.platform,
    String(row.minutes),
    numberCell(row.shortVideoMinutes),
    row.measurementScope,
    row.source,
    yesNoCell(row.plannedWindow),
  ]
}

// ---------------------------------------------------------------------------
// buildCsv
// ---------------------------------------------------------------------------

/**
 * Renders the full CSV body. `model.program.realm === 'demo'` is the ONLY
 * input that changes shape (the leading demo-label line) — every other
 * section is produced unconditionally, in the same fixed order, whether the
 * program has zero rows in a section or many.
 */
export function buildCsv(model: ExportModel): string {
  const blocks = [
    csvSection('program', PROGRAM_HEADER, [programRow(model.program)]),
    csvSection('revisions', REVISIONS_HEADER, model.revisions.map(revisionRow)),
    csvSection('attempts', ATTEMPTS_HEADER, model.attempts.map(attemptRow)),
    csvSection('days', DAYS_HEADER, model.days.map(dayRow)),
    csvSection('feed_rows', FEED_HEADER, model.feedRows.map(feedRow)),
  ]

  const body = blocks.join('\n\n')
  const isDemo = model.program.realm === 'demo'
  return isDemo ? `# ${EXPORT_DEMO_LABEL}\n\n${body}\n` : `${body}\n`
}
