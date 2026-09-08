/**
 * Export preview and download (task 8.8.4), mounted as a child section of
 * `Progress` (8.8.1's TODO slot below its `AttemptTable`). Fetches the
 * server-rendered `GET /programs/{id}/export?format=csv|markdown` text
 * verbatim (6.3.1/6.3.2) and previews it — nothing here re-derives or
 * reformats a single cell: the demo label, the blank-cell rule for
 * unreported counts, and every column come from the response body exactly
 * as the server wrote them (D4).
 *
 * The query is keyed by `format` (staleTime 0, gcTime 0 — the server sends
 * `Cache-Control: no-store`, so nothing about this response is worth
 * retaining once the format changes or the section unmounts) and there is
 * no shared `queryKeys` entry for it: this is the only reader of the
 * export text and nothing else ever invalidates it, so the key lives here
 * rather than growing the shared factory for a single call site.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { localDateAt } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import { FormatToggle } from './FormatToggle.js'
import type { ExportFormat } from './FormatToggle.js'

export interface ExportPreviewProps {
  readonly programId: string
}

const FILE_EXTENSION: Record<ExportFormat, string> = { csv: 'csv', markdown: 'md' }
const MIME_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
}

/** The viewer's own local calendar date — this names a downloaded file, not a program day; no server round trip is worth it for a filename. */
function todayLocalDate(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return localDateAt(new Date(), timeZone)
}

/** Builds a Blob from the already-fetched text, clicks a throwaway anchor, and revokes the object URL immediately after. */
function downloadText(text: string, format: ExportFormat): void {
  const blob = new Blob([text], { type: MIME_TYPE[format] })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `attention-lab-${todayLocalDate()}.${FILE_EXTENSION[format]}`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ExportPreview({ programId }: ExportPreviewProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')

  const exportQuery = useQuery({
    queryKey: ['programs', programId, 'export', format] as const,
    queryFn: () => api.export.get(programId, format),
    staleTime: 0,
    gcTime: 0,
  })

  const text = exportQuery.data
  const firstLine = text !== undefined ? (text.split('\n')[0] ?? '') : ''

  return (
    <section className="flex flex-col gap-3" aria-labelledby="export-preview-heading">
      <h2 id="export-preview-heading" className="text-base font-semibold">
        Export
      </h2>

      <FormatToggle value={format} onChange={setFormat} />

      <p className="text-sm text-[var(--color-text-muted)]">Not-reported values are exported as empty cells.</p>

      {exportQuery.isPending ? (
        <div aria-busy="true">Loading export preview</div>
      ) : exportQuery.isError || text === undefined ? (
        <div>
          <p>Export unavailable. Retry.</p>
          <Button
            onClick={() => {
              void exportQuery.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          <p data-testid="export-label-line" className="text-sm font-medium text-[var(--color-text)]">
            {firstLine}
          </p>
          {/* See ExactValuesTable.tsx's identical comment: `tabIndex={0}` for
              axe's "scrollable-region-focusable" (WCAG 2.1.1); no
              `role="region"` (a named landmark here would repeat "Export",
              already this section's own `aria-labelledby` name, and could
              collide the same way the table wrappers' did in practice). */}
          <div
            className="overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            tabIndex={0}
          >
            <pre data-testid="export-preview-text" className="whitespace-pre text-xs">
              {text}
            </pre>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              downloadText(text, format)
            }}
          >
            Download
          </Button>
        </>
      )}
    </section>
  )
}
