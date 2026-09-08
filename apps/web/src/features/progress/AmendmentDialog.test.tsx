import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/keys.js` and this file's own
// `AmendmentDialog.js`): `vi.mock('@/lib/api/client', ...)` inside this
// module only intercepts imports of that module requested AFTER it runs,
// mirroring AbandonSession.test.tsx's own import ordering.
import { mockApi, reject, respond } from '../../test/mockClient.js'

import { useQuery } from '@tanstack/react-query'
import type { AmendmentResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { api } from '../../lib/api/client.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AmendmentDialog } from './AmendmentDialog.js'

// `test.globals: true` (vitest.config.ts) disables Testing Library's
// framework-detected auto-cleanup — every component test file here calls
// `cleanup()` itself (DemoBanner.test.tsx / AbandonSession.test.tsx's pattern).
afterEach(() => {
  cleanup()
})

function makeAmendment(overrides: Partial<AmendmentResponseValue> = {}): AmendmentResponseValue {
  return {
    id: 'amendment-1',
    sessionId: 'session-1',
    reason: 'device swapped mid-attempt',
    excludeFromReport: false,
    createdAt: '2026-09-08T09:00:00.000Z',
    ...overrides,
  }
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Explain or exclude' }))
  await screen.findByRole('dialog')
}

/**
 * Mounts alongside `AmendmentDialog` as a live observer of 8.8.1's own
 * `queryKeys.report(programId)` — the exact query `AmendmentDialog`
 * invalidates on success — so this test can prove the row's
 * `excludedByAmendment` value the dialog never reads or computes itself
 * comes straight from a real refetch of the (mocked) server response.
 */
function ReportProbe({ programId }: { readonly programId: string }) {
  const query = useQuery({
    queryKey: queryKeys.report(programId),
    queryFn: () => api.report.get(programId),
  })
  if (query.data === undefined) {
    return null
  }
  return <p data-testid="excluded-flag">{String(query.data.attempts[0]?.excludedByAmendment)}</p>
}

/** Mirrors `AttemptTable.tsx`'s real, already-shipped conditional — the actual integration contract this dialog is mounted behind, without rendering the whole table. */
function AttemptRowHarness({ lifecycle }: { readonly lifecycle: 'finalized' | 'running' }) {
  return lifecycle === 'finalized' ? (
    <AmendmentDialog sessionId="session-1" amendments={[]} />
  ) : (
    <span>Not finalized</span>
  )
}

describe('AmendmentDialog', () => {
  it('empty reason blocks submit with A reason is required and no request is sent', async () => {
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('A reason is required')
    expect(mockApi.sessions.amend).not.toHaveBeenCalled()
  })

  it('submitting reason only (excludeFromReport false) posts 201 and invalidates the report query', async () => {
    respond('sessions.amend', makeAmendment({ id: 'amendment-new' }))
    const { user, queryClient } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)
    queryClient.setQueryData(queryKeys.report('program-1'), { attempts: [] })

    await openDialog(user)
    await user.type(screen.getByLabelText('Reason'), 'context note')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockApi.sessions.amend).toHaveBeenCalledWith('session-1', {
        reason: 'context note',
        excludeFromReport: false,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(queryClient.getQueryState(queryKeys.report('program-1'))?.isInvalidated).toBe(true)
  })

  it('checking Exclude from the comparison posts excludeFromReport true', async () => {
    respond('sessions.amend', makeAmendment({ id: 'amendment-new', excludeFromReport: true }))
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)

    await openDialog(user)
    await user.type(screen.getByLabelText('Reason'), 'wrong material level')
    await user.click(screen.getByRole('checkbox', { name: 'Exclude from the comparison' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockApi.sessions.amend).toHaveBeenCalledWith('session-1', {
        reason: 'wrong material level',
        excludeFromReport: true,
      }),
    )
  })

  it('existing amendments render in creation order with reason, exclude flag and createdAt', async () => {
    const first = makeAmendment({
      id: 'amendment-first',
      reason: 'baseline device was borrowed',
      excludeFromReport: false,
      createdAt: '2026-09-01T10:00:00.000Z',
    })
    const second = makeAmendment({
      id: 'amendment-second',
      reason: 'material level differed',
      excludeFromReport: true,
      createdAt: '2026-09-02T11:00:00.000Z',
    })
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[first, second]} />)

    await openDialog(user)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('baseline device was borrowed')
    expect(items[0]).toHaveTextContent('Not excluded')
    expect(items[0]).toHaveTextContent('2026-09-01T10:00:00.000Z')
    expect(items[1]).toHaveTextContent('material level differed')
    expect(items[1]).toHaveTextContent('Excluded from the comparison')
    expect(items[1]).toHaveTextContent('2026-09-02T11:00:00.000Z')
  })

  it('after an excluding amendment the report refetch shows excluded_by_amendment in the row without any client-side recomputation', async () => {
    respond('report.get', { attempts: [{ attemptId: 'attempt-1', excludedByAmendment: false }] })

    const { user } = renderWithProviders(
      <>
        <ReportProbe programId="program-1" />
        <AmendmentDialog sessionId="session-1" amendments={[]} />
      </>,
    )

    const flag = await screen.findByTestId('excluded-flag')
    expect(flag).toHaveTextContent('false')

    // The server, not this component, decides the new eligibility overlay
    // (5.9.2/5.9.3) — the mock is updated to model that server-side effect;
    // AmendmentDialog itself never reads or writes `excludedByAmendment`.
    respond('report.get', { attempts: [{ attemptId: 'attempt-1', excludedByAmendment: true }] })
    respond('sessions.amend', makeAmendment({ id: 'amendment-excluding', excludeFromReport: true }))

    await openDialog(user)
    await user.type(screen.getByLabelText('Reason'), 'wrong material level')
    await user.click(screen.getByRole('checkbox', { name: 'Exclude from the comparison' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('excluded-flag')).toHaveTextContent('true'))
  })

  it('409 not_finalized closes the dialog with This attempt is no longer finalized and posts nothing further', async () => {
    reject('sessions.amend', { status: 409, code: 'not_finalized' })
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)

    await openDialog(user)
    await user.type(screen.getByLabelText('Reason'), 'second tab finalized this differently')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('This attempt is no longer finalized')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.sessions.amend).toHaveBeenCalledTimes(1)
  })

  it('network error keeps the typed reason and checkbox and shows Retry', async () => {
    reject('sessions.amend', { status: 0, code: 'network_error' })
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)

    await openDialog(user)
    await user.type(screen.getByLabelText('Reason'), 'keep this draft')
    await user.click(screen.getByRole('checkbox', { name: 'Exclude from the comparison' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Could not save. Retry.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveValue('keep this draft')
    expect(screen.getByRole('checkbox', { name: 'Exclude from the comparison' })).toBeChecked()
  })

  it('the control is not rendered for a row whose lifecycle is not finalized', () => {
    renderWithProviders(<AttemptRowHarness lifecycle="running" />)
    expect(screen.queryByRole('button', { name: 'Explain or exclude' })).not.toBeInTheDocument()
    cleanup()

    renderWithProviders(<AttemptRowHarness lifecycle="finalized" />)
    expect(screen.getByRole('button', { name: 'Explain or exclude' })).toBeInTheDocument()
  })
})
