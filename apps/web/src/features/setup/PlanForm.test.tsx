import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type { CreateProgramBodyValue } from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { PlanForm } from './PlanForm.js'

/**
 * task 8.1.2's verify list, all 9 named cases. `PlanForm` navigates on its
 * own success/409 outcomes, so every case mounts it through a real 3-route
 * table (RailLayout.test.tsx's `buildRoutes()` pattern) rather than the
 * bare wildcard `renderWithProviders(<PlanForm />)` shortcut — the
 * destination screens are plain headings standing in for 8.1.3's
 * ReadinessForm and 8.2.1's Today, which this task does not own.
 */

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

function buildRoutes(): RouteObject[] {
  return [
    { path: '/setup', element: <PlanForm /> },
    { path: '/setup/readiness', element: <h1>Readiness screen</h1> },
    { path: '/today', element: <h1>Today screen</h1> },
  ]
}

// `ui` is unused whenever `routes` is supplied (renderWithProviders.tsx);
// the fragment is a placeholder to satisfy the required parameter.
function mount() {
  return renderWithProviders(<></>, { route: '/setup', routes: buildRoutes() })
}

type MountResult = ReturnType<typeof mount>

/** Fills the baseline date and (unless `confirm` is false) checks the timezone confirmation. Every other field keeps its default (10 minutes, leisure 20, feed estimate blank). */
async function fillBaseline(user: MountResult['user'], options: { confirm?: boolean } = {}) {
  const { confirm = true } = options
  const dateInput = screen.getByLabelText('Baseline date (Day 0)')
  fireEvent.change(dateInput, { target: { value: '2026-09-08' } })
  if (confirm) {
    await user.click(screen.getByLabelText('Confirm timezone'))
  }
}

/** The most recent `api.programs.create(body, options)` call's arguments. */
function lastCreateCall(): [CreateProgramBodyValue, { idempotencyKey: string }] {
  const calls = mockApi.programs.create.mock.calls
  const call = calls[calls.length - 1]
  if (call === undefined) {
    throw new Error('api.programs.create was never called')
  }
  return call as [CreateProgramBodyValue, { idempotencyKey: string }]
}

describe('PlanForm', () => {
  it('omits feedEstimateMinutes when blank', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    const [body] = lastCreateCall()
    expect('feedEstimateMinutes' in body).toBe(false)
  })

  it('never sends feedEstimateMinutes 0 for a blank field', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user)
    // The feed-estimate field is left untouched (blank) deliberately.
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    const [body] = lastCreateCall()
    expect(body.feedEstimateMinutes).not.toBe(0)
    expect('feedEstimateMinutes' in body).toBe(false)
  })

  it('blocks save until timezone is confirmed and sends the confirmed value', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user, { confirm: false })
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockApi.programs.create).not.toHaveBeenCalled()
    expect(screen.getByText('Confirm your timezone before saving.')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Confirm timezone'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    const [body] = lastCreateCall()
    expect(body.timezone).toBe('America/New_York')
  })

  it('accepts 5-minute duration as practiceTargetSeconds 300 and sends no bandCeilings', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('radio', { name: '5 minutes' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    const [body] = lastCreateCall()
    expect(body.practiceTargetSeconds).toBe(300)
    expect('bandCeilings' in body).toBe(false)
  })

  it('409 routes to the existing program (draft -> readiness, otherwise today)', async () => {
    reject('programs.create', {
      status: 409,
      code: 'program_exists',
      details: { existingProgramId: 'p1', existingStatus: 'draft' },
    })
    respond('programs.current', {
      program: { id: 'p1', status: 'draft' },
      revision: null,
      slots: [],
      day: null,
      nextAction: { kind: 'readiness' },
    })
    const draft = mount()
    await fillBaseline(draft.user)
    await draft.user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByRole('heading', { name: 'Readiness screen' })
    expect(draft.router.state.location.pathname).toBe('/setup/readiness')
    cleanup()

    reject('programs.create', {
      status: 409,
      code: 'program_exists',
      details: { existingProgramId: 'p2', existingStatus: 'active' },
    })
    respond('programs.current', {
      program: { id: 'p2', status: 'active' },
      revision: null,
      slots: [],
      day: 3,
      nextAction: { kind: 'progress' },
    })
    const active = mount()
    await fillBaseline(active.user)
    await active.user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByRole('heading', { name: 'Today screen' })
    expect(active.router.state.location.pathname).toBe('/today')
  })

  it('network failure shows could-not-save and does not navigate', async () => {
    reject('programs.create', { status: 0, code: 'network_error' })
    const { user, router } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Could not save the plan')
    expect(router.state.location.pathname).toBe('/setup')
  })

  it('retry reuses the same Idempotency-Key', async () => {
    reject('programs.create', { status: 0, code: 'network_error' })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Could not save the plan')

    const firstKey = lastCreateCall()[1].idempotencyKey

    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(2))
    expect(lastCreateCall()[1].idempotencyKey).toBe(firstKey)
  })

  it('never calls POST /sessions', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    expect(mockApi.sessions.create).not.toHaveBeenCalled()
  })

  it('400 fieldErrors render beside the named field', async () => {
    reject('programs.create', {
      status: 400,
      code: 'malformed_request',
      fieldErrors: { timezone: ['Not a valid timezone.'] },
    })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const message = await screen.findByText('Not a valid timezone.')
    const select = screen.getByLabelText('Timezone')
    expect(select).toHaveAttribute('aria-describedby', message.id)
  })
})
