/**
 * The shared "exact values" table primitive (task 8.8.3), reused by
 * `PracticeTrend` and `DailyTrend`: progress-report spec, "Charts carry
 * exact values" — every chart in this section is accompanied by the exact
 * numbers and their source labels in an ordinary, non-`aria-hidden` table,
 * so the chart is never the only place a value lives.
 *
 * Body cells render `font-mono` at the table level: this IS "the
 * exact-values tables" named in the rework spec §4's mono rule. Headers are
 * pulled back to `font-sans` — mono is never for labels or metadata, only
 * for the figures themselves.
 *
 * See `AttemptTable.tsx`'s identical comment for why this composes shadcn's
 * table PARTS (`TableHeader`/`TableBody`/`TableRow`/`TableHead`/
 * `TableCell`/`TableCaption`) onto a plain `<table>` rather than using
 * shadcn's own `Table` wrapper: that component's own internal
 * `overflow-x-auto` div has no `tabIndex`, and nesting it inside this file's
 * wrapper would make the WRONG div the one axe expects to be focusable.
 */
import type { ReactNode } from 'react'

import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../ui/shadcn/table.js'

export interface ExactValuesTableRow {
  readonly key: string
  readonly cells: readonly ReactNode[]
}

export interface ExactValuesTableProps {
  readonly caption: string
  readonly columns: readonly string[]
  readonly rows: readonly ExactValuesTableRow[]
  readonly emptyMessage: string
}

export function ExactValuesTable({ caption, columns, rows, emptyMessage }: ExactValuesTableProps) {
  if (rows.length === 0) {
    return <p>{emptyMessage}</p>
  }

  return (
    // `tabIndex={0}`: axe's "scrollable-region-focusable" (WCAG 2.1.1) — a
    // horizontally-scrollable region with real (non-hidden) content must
    // itself be reachable and operable by keyboard. No `role="region"`/
    // `aria-label` here: the table's own `caption` already gives it an
    // accessible name, and adding a SECOND named landmark on top collided
    // with other same-page region names in practice (confirmed empirically
    // — `day8-revision.spec.ts`'s own `getByRole('region', {name:
    // 'Practice'})` started matching two elements once this wrapper's
    // 'Practice blocks' label was added).
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-left font-mono text-sm">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-rule text-ink-muted">
            {columns.map((column) => (
              <TableHead key={column} scope="col" className="px-2 py-2 font-sans font-medium">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} className="border-b border-rule align-top">
              {row.cells.map((cell, index) => (
                // `index` is a stable key here: a row's cell list is fixed
                // (one entry per `columns`) and never reordered independently
                // of its own row.
                <TableCell key={index} className="px-2 py-2">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  )
}
