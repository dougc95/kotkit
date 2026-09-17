import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  it('heading matches every other page heading: text-lg font-semibold text-ink, not text-xl (task V5)', () => {
    mount()

    const heading = screen.getByRole('heading', { level: 1, name: 'Set up your plan' })
    expect(heading.className).toContain('text-lg')
    expect(heading.className).toContain('font-semibold')
    expect(heading.className).toContain('text-ink')
    expect(heading.className).not.toContain('text-xl')
  })

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

  it('network failure shows could-not-save, colored for attention (U15a), and does not navigate', async () => {
    reject('programs.create', { status: 0, code: 'network_error' })
    const { user, router } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not save the plan')
    expect(alert).toHaveClass('text-attention')
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

  it('shows the blank feed estimate as Not reported, and a typed value as recorded', async () => {
    mount()

    const blank = screen.getByText('Not reported')
    expect(blank).toHaveAttribute('data-tier', 'absent')

    const feedInput = screen.getByLabelText('Current daily feed time (estimate)')
    fireEvent.change(feedInput, { target: { value: '0' } })

    const recorded = await screen.findByText('0 min/day')
    expect(recorded).toHaveAttribute('data-tier', 'recorded')
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument()
  })

  it('previews 007 honestly as 7 min/day, not the raw string the form would never actually send', async () => {
    mount()

    const feedInput = screen.getByLabelText('Current daily feed time (estimate)')
    fireEvent.change(feedInput, { target: { value: '007' } })

    const recorded = await screen.findByText('7 min/day')
    expect(recorded).toHaveAttribute('data-tier', 'recorded')
    expect(screen.queryByText('007 min/day')).not.toBeInTheDocument()
  })

  it('previews nothing for -5 (validate() rejects it, so no tier is a truthful preview of it)', async () => {
    mount()

    const feedInput = screen.getByLabelText('Current daily feed time (estimate)')
    fireEvent.change(feedInput, { target: { value: '-5' } })

    await waitFor(() => {
      expect(screen.queryByText('Not reported')).not.toBeInTheDocument()
    })
    const wrapper = feedInput.closest('div')
    expect(wrapper).not.toBeNull()
    expect(wrapper!.querySelector('[data-tier]')).toBeNull()
  })

  // task-21-amendment.md's replacement test list (supersedes the brief's
  // Step 1/Step 2, which withdrew the Timezone Select conversion).

  it('the duration radios sit inside a radiogroup named by the legend', () => {
    mount()

    const group = screen.getByRole('radiogroup', { name: 'Practice block duration' })
    expect(within(group).getByRole('radio', { name: '5 minutes' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '10 minutes' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '15 minutes' })).toBeInTheDocument()
  })

  it('accepts 15-minute duration as practiceTargetSeconds 900', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user)
    await user.click(screen.getByRole('radio', { name: '15 minutes' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.programs.create).toHaveBeenCalledTimes(1))
    const [body] = lastCreateCall()
    expect(body.practiceTargetSeconds).toBe(900)
  })

  it('the timezone error is attention-coloured and associated with the select', async () => {
    respond('programs.create', { program: { id: 'p1' }, revision: { id: 'r1' } })
    const { user } = mount()

    await fillBaseline(user, { confirm: false })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const message = screen.getByText('Confirm your timezone before saving.')
    expect(message).toHaveClass('text-attention')
    const select = screen.getByLabelText('Timezone')
    expect(select).toHaveAttribute('aria-describedby', message.id)
  })

  // Pin, not a red case: e2e/acceptance/new-user.spec.ts reads this control
  // with page.getByLabel('Timezone', { exact: true }).inputValue(), which
  // only works on a native <input>/<textarea>/<select> — never convert this
  // to a Radix Select.
  it('the Timezone control stays a native select', () => {
    mount()

    expect(screen.getByLabelText('Timezone', { exact: true }).tagName).toBe('SELECT')
  })

  it('the Timezone select sits on the page ground like every other field, not raised card white (task V5)', () => {
    mount()

    const select = screen.getByLabelText('Timezone', { exact: true })
    expect(select.className).toContain('bg-transparent')
    expect(select.className).not.toContain('bg-card')
    expect(select.className).toContain('text-base')
    expect(select.className).toContain('md:text-sm')
  })

  it('Confirm timezone is still operable by its label', async () => {
    const { user } = mount()

    const checkbox = screen.getByLabelText('Confirm timezone')
    await user.click(checkbox)

    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })
})
