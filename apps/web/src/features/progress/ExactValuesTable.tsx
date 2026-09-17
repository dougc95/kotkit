/**
 * The shared "exact values" table primitive (task 8.8.3), reused by
 * `PracticeTrend` and `DailyTrend`: progress-report spec, "Charts carry
 * exact values" — every chart in this section is accompanied by the exact
 * numbers and their source labels in an ordinary, non-`aria-hidden` table,
 * so the chart is never the only place a value lives.
 *
 * Mono is applied per FIGURE CELL by the caller, through `<Reported mono>`
 * (`PracticeTrend`/`DailyTrend`) — never at the table level. An earlier
 * version set `font-mono` on the whole `<table>`, but a RECORDED status word
 * such as 'Complete' or 'OK' has no font class of its own and inherited it,
 * visibly mixing typefaces inside one column against a 'Not reported' cell
 * next to it in sans (fix round 1, finding 2). `AttemptTable` (Task 47)
 * already applies mono per cell for the same reason; this file now matches
 * it exactly.
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
    <div className="relative overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-rule text-ink-muted">
            {columns.map((column) => (
              // `whitespace-normal`: shadcn's `TableHead` base class carries
              // `whitespace-nowrap`, which stopped a long header label like
              // 'Unspecified device (device-minutes)' from wrapping, widening
              // the table on narrow viewports (fix round 1, finding 3).
              // `cn()` merges this caller class last, so it wins.
              <TableHead key={column} scope="col" className="px-2 py-2 font-medium whitespace-normal">
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
                //
                // `align-top`: shadcn's `TableCell` base class carries
                // `align-middle`, which made this row's own `align-top`
                // inert (fix round 1, finding 3). Body cells stay
                // `whitespace-nowrap` (shadcn's default) — their content is
                // short and digits must not wrap.
                <TableCell key={index} className="px-2 py-2 align-top">
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
