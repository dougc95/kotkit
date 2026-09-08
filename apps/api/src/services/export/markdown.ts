/**
 * Task 6.3.2 — renders an `ExportModel` (`./model.js`) as GitHub-flavored
 * Markdown, reusing `csv.ts`'s header arrays and per-row `string[]` mappers
 * (D16: one owner per shared "which columns, which cell text" derivation) so
 * the two formats can never disagree on a column list or a cell's blank
 * rule — only the final assembly into text differs: comma-and-quote there,
 * a pipe table here. `exportFirstSwitchState`/`exportFirstSwitchSeconds`
 * (`model.ts`) already feed `attemptRow`, so `t_state` values like
 * `'20+, capped'` and `'Unknown'` reach this renderer the same way they
 * reach the CSV one.
 *
 * Layout: an optional demo-label line, then `# Attention Lab program
 * record`, and five `## <Section>` tables in the same fixed order as the
 * CSV (`program`, `revisions`, `attempts`, `days`, `feed_rows`) — the
 * attempts table alone is preceded by the caption `_All counts are
 * self-reported_`. Every free-text field (`note`, `output_note`,
 * `disruption_note`, recall points, `review_note`, `intended_output`) is
 * absent from `ExportModel` itself, so nothing here can leak it.
 */
import {
  ATTEMPTS_HEADER,
  DAYS_HEADER,
  EXPORT_DEMO_LABEL,
  FEED_HEADER,
  PROGRAM_HEADER,
  REVISIONS_HEADER,
  attemptRow,
  dayRow,
  feedRow,
  programRow,
  revisionRow,
} from './csv.js'
import type { ExportModel } from './model.js'

// ---------------------------------------------------------------------------
// Pipe-table primitives
// ---------------------------------------------------------------------------

/** The one character that would otherwise break a Markdown table row: `|` -> `\|` (per task 6.3.2). */
export function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

export function mdRow(fields: readonly string[]): string {
  return `| ${fields.map(mdCell).join(' | ')} |`
}

function mdTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const divider = header.map(() => '---')
  return [mdRow(header), mdRow(divider), ...rows.map(mdRow)].join('\n')
}

// ---------------------------------------------------------------------------
// buildMarkdown
// ---------------------------------------------------------------------------

/** The caption that precedes the attempts table — asserted verbatim by the integration test. */
export const ATTEMPTS_CAPTION = 'All counts are self-reported'

/**
 * Renders the full Markdown body. `model.program.realm === 'demo'` is the
 * ONLY input that changes shape (the leading demo-label line) — every other
 * section is produced unconditionally, in the same fixed order, whether the
 * program has zero rows in a section or many (matching `buildCsv`).
 */
export function buildMarkdown(model: ExportModel): string {
  const sections = [
    '## Program',
    mdTable(PROGRAM_HEADER, [programRow(model.program)]),
    '## Revisions',
    mdTable(REVISIONS_HEADER, model.revisions.map(revisionRow)),
    '## Attempts',
    `_${ATTEMPTS_CAPTION}_`,
    mdTable(ATTEMPTS_HEADER, model.attempts.map(attemptRow)),
    '## Days',
    mdTable(DAYS_HEADER, model.days.map(dayRow)),
    '## Feed rows',
    mdTable(FEED_HEADER, model.feedRows.map(feedRow)),
  ]

  const body = ['# Attention Lab program record', ...sections].join('\n\n')
  const isDemo = model.program.realm === 'demo'
  return isDemo ? `# ${EXPORT_DEMO_LABEL}\n\n${body}\n` : `${body}\n`
}
