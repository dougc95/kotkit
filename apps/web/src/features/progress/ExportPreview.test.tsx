import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'

import { mockApi, reject } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { ExportPreview } from './ExportPreview.js'

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render.
afterEach(() => {
  cleanup()
})

const DEMO_LABEL = '# Demonstration data — synthetic local-demo records, not a real measurement'

/**
 * A CSV fixture shaped like the real 6.3.1 export (same section order and
 * the same 25-column attempts header the committed API snapshot carries) —
 * built from field arrays rather than typed by hand so the blank-count row
 * lands its empty cell and its `exclusion_reasons` value in the right
 * columns without a miscount.
 */
const ATTEMPT_COLUMNS = [
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

function attemptRow(fields: Partial<Record<(typeof ATTEMPT_COLUMNS)[number], string>>): string {
  return ATTEMPT_COLUMNS.map((column) => fields[column] ?? '').join(',')
}

const REPORTED_ROW = attemptRow({
  attempt_id: 'attempt-a',
  phase: 'baseline',
  label: 'A',
  local_date: '2026-09-05',
  realm: 'demo',
  time_source: 'demo_clock',
  s: '6',
  s_method: 'event',
  t_state: 'known',
  t_seconds: '620',
  t_method: 'event',
  recall_score: '4',
  e: '1',
  m: '1',
  disruption: 'no',
  eligible: 'true',
  protocol_revision: '1',
  lifecycle: 'finalized',
})

const BLANK_COUNT_ROW = attemptRow({
  attempt_id: 'attempt-b',
  phase: 'baseline',
  label: 'B',
  local_date: '2026-09-05',
  realm: 'demo',
  time_source: 'measured',
  // s, s_method and t_state left blank on purpose: the fixture under test.
  eligible: 'false',
  exclusion_reasons: 'count_unknown',
  protocol_revision: '1',
  lifecycle: 'finalized',
})

function csvFixture(): string {
  return [
    DEMO_LABEL,
    '',
    '# attempts',
    ATTEMPT_COLUMNS.join(','),
    REPORTED_ROW,
    BLANK_COUNT_ROW,
    '',
  ].join('\n')
}

function markdownFixture(): string {
  return [DEMO_LABEL, '', '# Attention Lab program record', '', '## Attempts', '', '_All counts are self-reported_'].join(
    '\n',
  )
}

beforeEach(() => {
  // Reasserted per-test: `src/test/setup.ts`'s top-level stub is wiped by its
  // own `afterEach(() => vi.resetAllMocks())`, which clears a `vi.fn(impl)`'s
  // constructor implementation along with its call history.
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  window.URL.revokeObjectURL = vi.fn()
})

describe('ExportPreview', () => {
  it('CSV preview first line is the demonstration label', async () => {
    mockApi.export.get.mockResolvedValue(csvFixture())

    renderWithProviders(<ExportPreview programId="program-1" />)

    expect(await screen.findByTestId('export-label-line')).toHaveTextContent(DEMO_LABEL)
    expect(screen.getByTestId('export-preview-text').textContent?.startsWith(DEMO_LABEL)).toBe(true)
    expect(mockApi.export.get).toHaveBeenCalledWith('program-1', 'csv')
  })

  it('the blank-count fixture row has an empty S cell in the preview text and its exclusion column lists count unknown', async () => {
    mockApi.export.get.mockResolvedValue(csvFixture())

    renderWithProviders(<ExportPreview programId="program-1" />)

    const preview = await screen.findByTestId('export-preview-text')
    const rows = (preview.textContent ?? '').split('\n')
    const blankRow = rows.find((row) => row.startsWith('attempt-b,'))
    expect(blankRow).toBeDefined()
    const cells = (blankRow ?? '').split(',')
    expect(cells[ATTEMPT_COLUMNS.indexOf('s')]).toBe('')
    expect(cells[ATTEMPT_COLUMNS.indexOf('exclusion_reasons')]).toBe('count_unknown')
  })

  it('switching to Markdown refetches with format=markdown and shows its label line', async () => {
    mockApi.export.get.mockImplementation((_programId: string, format: 'csv' | 'markdown') =>
      Promise.resolve(format === 'csv' ? csvFixture() : markdownFixture()),
    )

    const { user } = renderWithProviders(<ExportPreview programId="program-1" />)

    expect(await screen.findByTestId('export-label-line')).toHaveTextContent(DEMO_LABEL)
    expect(mockApi.export.get).toHaveBeenCalledWith('program-1', 'csv')

    await user.click(screen.getByRole('radio', { name: 'Markdown' }))

    await waitFor(() => expect(mockApi.export.get).toHaveBeenCalledWith('program-1', 'markdown'))
    await waitFor(() =>
      expect(screen.getByTestId('export-preview-text')).toHaveTextContent('# Attention Lab program record'),
    )
    expect(screen.getByTestId('export-label-line')).toHaveTextContent(DEMO_LABEL)
  })

  it('Download creates a blob URL from the fetched text with the .csv filename and revokes it', async () => {
    const text = csvFixture()
    mockApi.export.get.mockResolvedValue(text)

    const { user } = renderWithProviders(<ExportPreview programId="program-1" />)

    await screen.findByTestId('export-preview-text')
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blobArg = vi.mocked(window.URL.createObjectURL).mock.calls[0]?.[0] as Blob
    expect(blobArg).toBeInstanceOf(Blob)
    await expect(blobArg.text()).resolves.toBe(text)

    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('error renders Export unavailable with Retry', async () => {
    reject('export.get', { status: 500, code: 'server_error' })

    renderWithProviders(<ExportPreview programId="program-1" />)

    expect(await screen.findByText('Export unavailable. Retry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('export-preview-text')).not.toBeInTheDocument()
  })

  it('after unmount the query cache holds no export text (gcTime 0)', async () => {
    mockApi.export.get.mockResolvedValue(csvFixture())

    const { unmount, queryClient } = renderWithProviders(<ExportPreview programId="program-1" />)

    await screen.findByTestId('export-preview-text')
    expect(queryClient.getQueryData(['programs', 'program-1', 'export', 'csv'])).toBeDefined()

    unmount()

    await waitFor(() =>
      expect(queryClient.getQueryData(['programs', 'program-1', 'export', 'csv'])).toBeUndefined(),
    )
  })
})
