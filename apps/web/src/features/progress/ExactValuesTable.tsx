/**
 * The shared "exact values" table primitive (task 8.8.3), reused by
 * `PracticeTrend` and `DailyTrend`: progress-report spec, "Charts carry
 * exact values" — every chart in this section is accompanied by the exact
 * numbers and their source labels in an ordinary, non-`aria-hidden` table,
 * so the chart is never the only place a value lives.
 */
import type { ReactNode } from 'react'

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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-2 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-[var(--color-border)] align-top">
              {row.cells.map((cell, index) => (
                // `index` is a stable key here: a row's cell list is fixed
                // (one entry per `columns`) and never reordered independently
                // of its own row.
                <td key={index} className="px-2 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
