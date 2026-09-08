import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type {
  CreateRevisionBodyValue,
  CurrentProgramResponseValue,
  ProgramResponseValue,
  RevisionResponseValue,
} from '@attention-lab/shared'

import type { CreateRevisionResult } from '../../lib/api/client.js'
import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { queryKeys } from '../../lib/query/keys.js'
import { ChangePracticeDuration } from './ChangePracticeDuration.js'

/**
 * task 8.9.5's verify list, all 8 named cases. `ChangePracticeDuration`
 * fetches its own `GET /programs/current` (props: none, like
 * `Preferences.tsx`'s own local `programs.current` fetch), so every case
 * mounts it directly rather than through `Settings.tsx` or a router table.
 */

const NO_PROGRAM: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

function revisionFixture(overrides: Partial<RevisionResponseValue> = {}): RevisionResponseValue {
  return {
    id: 'revision-1',
    revision: 1,
    effectiveDay: 0,
    settings: {
      practiceTargetSeconds: 900,
      bandCeilings: [{ fromDay: 1, toDay: 3, minutes: 10 }],
      leisureAllowanceMin: 20,
    },
    reason: 'initial',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function programFixture(overrides: Partial<ProgramResponseValue> = {}): ProgramResponseValue {
  return {
    id: 'program-1',
    realm: 'demo',
    status: 'active',
    baselineDate: '2026-09-01',
    timezone: 'America/New_York',
    leisureAllowanceMinutes: 20,
    feedEstimateMinutes: null,
    currentRevisionId: 'revision-1',
    version: 1,
    ...overrides,
  }
}

function activeProgramResponse(
  overrides: { day?: number; status?: ProgramResponseValue['status'] } = {},
  revisionOverrides: Partial<RevisionResponseValue> = {},
): CurrentProgramResponseValue {
  return {
    program: programFixture(overrides.status !== undefined ? { status: overrides.status } : {}),
    revision: revisionFixture(revisionOverrides),
    slots: [],
    day: overrides.day ?? 8,
    nextAction: { kind: 'practice', block: 1 },
  }
}

afterEach(() => {
  cleanup()
})

function mount(program: CurrentProgramResponseValue) {
  respond('programs.current', program)
  return renderWithProviders(<ChangePracticeDuration />)
}

/** The most recent `api.programs.createRevision(id, body)` call's argument tuple. */
function lastCreateRevisionCall(): [string, CreateRevisionBodyValue] {
  const calls = mockApi.programs.createRevision.mock.calls
  const call = calls[calls.length - 1]
  if (call === undefined) {
    throw new Error('api.programs.createRevision was never called')
  }
  return call as [string, CreateRevisionBodyValue]
}

function successResult(practiceTargetSeconds: number, reason: string): CreateRevisionResult {
  return {
    revision: revisionFixture({
      id: 'revision-2',
      revision: 2,
      effectiveDay: 8,
      reason,
      settings: { practiceTargetSeconds, bandCeilings: [], leisureAllowanceMin: 20 },
    }),
    program: programFixture(),
  }
}

describe('ChangePracticeDuration', () => {
  it('loads the current governing practiceTargetSeconds as the default', async () => {
    mount(activeProgramResponse({}, { settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 } }))

    const radio = await screen.findByRole('radio', { name: '15 minutes' })
    expect(radio).toBeChecked()
    expect(screen.getByRole('radio', { name: '5 minutes' })).not.toBeChecked()
  })

  it('empty reason blocks submit with A reason is required and no request is sent', async () => {
    const { user } = mount(activeProgramResponse())

    await screen.findByRole('radio', { name: '15 minutes' })
    await user.click(screen.getByRole('radio', { name: '20 minutes' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A reason is required')).toBeInTheDocument()
    expect(mockApi.programs.createRevision).not.toHaveBeenCalled()
  })

  it('submit posts effectiveDay as today, settings spreading the current revision with the new practiceTargetSeconds, and the typed reason', async () => {
    respond('programs.createRevision', successResult(1200, 'more time to finish the chapter'))
    const { user } = mount(activeProgramResponse({ day: 8 }, { settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 } }))

    await screen.findByRole('radio', { name: '15 minutes' })
    await user.click(screen.getByRole('radio', { name: '20 minutes' }))
    await user.type(screen.getByLabelText('Reason for change'), 'more time to finish the chapter')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.createRevision).toHaveBeenCalledTimes(1))
    const [id, body] = lastCreateRevisionCall()
    expect(id).toBe('program-1')
    expect(body).toEqual({
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 1200, leisureAllowanceMin: 20 },
      reason: 'more time to finish the chapter',
    })
  })

  it('success shows the updated confirmation and invalidates programs/current and today', async () => {
    respond('programs.createRevision', successResult(1200, 'more time'))
    const { user, queryClient } = mount(activeProgramResponse({ day: 8 }))
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await screen.findByRole('radio', { name: '15 minutes' })
    await user.click(screen.getByRole('radio', { name: '20 minutes' }))
    await user.type(screen.getByLabelText('Reason for change'), 'more time')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Practice duration updated for today onward.')).toBeInTheDocument()
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.programs.current })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.programs.today('program-1') })
  })

  it('server 400 fieldErrors.reason renders inline and keeps the typed values', async () => {
    reject('programs.createRevision', {
      status: 400,
      code: 'malformed_request',
      fieldErrors: { reason: ['A reason is required'] },
    })
    const { user } = mount(activeProgramResponse({ day: 8 }))

    await screen.findByRole('radio', { name: '15 minutes' })
    await user.click(screen.getByRole('radio', { name: '20 minutes' }))
    await user.type(screen.getByLabelText('Reason for change'), 'a typed reason')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A reason is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason for change')).toHaveValue('a typed reason')
    expect(screen.getByRole('radio', { name: '20 minutes' })).toBeChecked()
  })

  it('422 effective_day_in_past renders the banner defensively', async () => {
    reject('programs.createRevision', {
      status: 422,
      code: 'effective_day_in_past',
    })
    const { user } = mount(activeProgramResponse({ day: 8 }))

    await screen.findByRole('radio', { name: '15 minutes' })
    await user.click(screen.getByRole('radio', { name: '20 minutes' }))
    await user.type(screen.getByLabelText('Reason for change'), 'a typed reason')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('This program day has already passed; changes apply from today onward'),
    ).toBeInTheDocument()
  })

  it('not rendered when no non-terminal program exists', async () => {
    const { queryClient, container } = mount(NO_PROGRAM)
    await waitFor(() => expect(queryClient.getQueryState(queryKeys.programs.current)?.status).toBe('success'))
    expect(container).toBeEmptyDOMElement()

    cleanup()

    const { queryClient: queryClient2, container: container2 } = mount(activeProgramResponse({ status: 'archived' }))
    await waitFor(() => expect(queryClient2.getQueryState(queryKeys.programs.current)?.status).toBe('success'))
    expect(container2).toBeEmptyDOMElement()
  })

  it('Submit is the only primary action on the panel', async () => {
    mount(activeProgramResponse())

    await screen.findByRole('radio', { name: '15 minutes' })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Save')
    expect(buttons[0]).toHaveAttribute('data-variant', 'primary')
  })
})
