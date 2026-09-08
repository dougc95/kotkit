import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentPlanResponseValue, SessionResponseValue } from '@attention-lab/shared'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/hooks.js` and this file's own
// `AgentPanel.js`/`TransitionControls.js`): `vi.mock('@/lib/api/client', ...)`
// inside this module only intercepts imports of that module requested AFTER
// it runs, mirroring TransitionControls.test.tsx/AbandonSession.test.tsx's
// own import ordering.
import { mockApi, reject, respond } from '../../test/mockClient.js'

import { useSession } from '../../lib/query/hooks.js'
import { makeSession } from '../../lib/query/testSessionFixture.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AgentPanel } from './AgentPanel.js'
import { TransitionControls } from './TransitionControls.js'
import { useRemaining } from './useRemaining.js'

/**
 * task 8.5.5's verify list, all 8 named cases. Deliberately self-contained:
 * never renders the real `Focus` screen (8.5.3, a different task's file —
 * see this task's own `centralWiringNeeded` report for the one-line slot
 * edit `Focus.tsx` still needs) or imports anything from it.
 * `SessionHarness`/`BreakHarness` below mount `AgentPanel` off the SAME
 * `useSession(id)` query `Focus.tsx` will read once wired — subscribed to
 * the identical `['sessions', id]` cache entry both `AgentPanel`'s own PUT
 * mutation and the shared `useTransition` (8.5.4) write to — so the
 * cache-sharing assertions below exercise the real mechanism, not a
 * stand-in.
 */

afterEach(() => {
  cleanup()
})

function makePlan(overrides: Partial<AgentPlanResponseValue> = {}): AgentPlanResponseValue {
  return {
    sessionId: 'focus-session',
    workstream: null,
    waitingTask: null,
    reviewCheckpoint: null,
    resumeNote: null,
    reviewAt: null,
    version: 1,
    ...overrides,
  }
}

async function openPanel(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Waiting on an agent?' }))
  await screen.findByLabelText('Workstream')
}

/**
 * A minimal in-memory "server" backing BOTH `sessions.get` and
 * `sessions.transition` consistently — mirrors TransitionControls.test.tsx's
 * own `mockSessionServer` (8.5.4) exactly, for the identical reason: the
 * shared `useTransition`'s own `onSuccess` invalidates `['sessions', id]` in
 * addition to writing the fresh value directly, and with an active
 * `useSession` observer (`BreakHarness`) that invalidation triggers a REAL
 * refetch — a `respond('sessions.get', ...)` call fixed to the ORIGINAL
 * session would let that refetch clobber the just-applied pause with stale
 * ("still running") data.
 */
function mockSessionServer(initial: SessionResponseValue): {
  resolveNextTransitionWith(session: SessionResponseValue): void
} {
  let current = initial
  mockApi.sessions.get.mockImplementation(() => Promise.resolve(current))
  return {
    resolveNextTransitionWith(session: SessionResponseValue): void {
      mockApi.sessions.transition.mockImplementationOnce(() => {
        current = session
        return Promise.resolve(session)
      })
    },
  }
}

/** Reads the SAME `['sessions', id]` query `AgentPanel` mutates against, and renders the numeric `remaining` D5 derivation as plain text — a probe for "the timer keeps deriving remaining while the plan is saved", never combined with any rendering of `AgentPanel` itself. */
function RemainingProbe({ sessionId }: { readonly sessionId: string }) {
  const { data: session } = useSession(sessionId)
  const remaining = useRemaining(session ?? null)
  return <p data-testid="remaining">{remaining}</p>
}

function SessionHarness({ sessionId }: { readonly sessionId: string }) {
  const { data: session } = useSession(sessionId)
  if (session === undefined) {
    return null
  }
  return (
    <>
      <RemainingProbe sessionId={sessionId} />
      <AgentPanel
        sessionId={session.id}
        sessionVersion={session.version}
        plan={session.agentPlan}
        lifecycle={session.lifecycle}
      />
    </>
  )
}

/** Adds `TransitionControls` (8.5.4) alongside `AgentPanel`, both reading the
 * same live `useSession` query — only the screen-free-break case needs both
 * mounted together, mirroring TransitionControls.test.tsx's own
 * `EventsHarness`. */
function BreakHarness({ sessionId }: { readonly sessionId: string }) {
  const { data: session } = useSession(sessionId)
  if (session === undefined) {
    return null
  }
  return (
    <>
      <TransitionControls session={session} />
      <AgentPanel
        sessionId={session.id}
        sessionVersion={session.version}
        plan={session.agentPlan}
        lifecycle={session.lifecycle}
      />
    </>
  )
}

describe('AgentPanel', () => {
  it('collapsed by default', () => {
    renderWithProviders(<AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />)

    expect(screen.getByRole('button', { name: 'Waiting on an agent?' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Workstream')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take a screen-free break' })).not.toBeInTheDocument()
  })

  it('Save sends PUT with expectedVersion and remaining keeps deriving from the clock', async () => {
    const session = makeSession({ id: 'focus-session', version: 3, targetSeconds: 900, agentPlan: null })
    respond('sessions.get', session)
    respond(
      'sessions.putAgentPlan',
      makePlan({ workstream: 'Draft PR review', reviewCheckpoint: 'end_of_block', version: 1 }),
    )

    const { user } = renderWithProviders(<SessionHarness sessionId={session.id} />)

    const before = await screen.findByTestId('remaining')
    const beforeText = before.textContent

    await openPanel(user)
    await user.type(screen.getByLabelText('Workstream'), 'Draft PR review')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))

    await waitFor(() =>
      expect(mockApi.sessions.putAgentPlan).toHaveBeenCalledWith(session.id, {
        expectedVersion: 0,
        workstream: 'Draft PR review',
        waitingTask: '',
        reviewCheckpoint: 'end_of_block',
        resumeNote: '',
      }),
    )

    // Unaffected by the plan save: same D5 derivation, no reset, no gap.
    expect(screen.getByTestId('remaining')).toHaveTextContent(beforeText ?? '')
  })

  it('409 stale keeps the first values, shows the notice and offers reload', async () => {
    const plan = makePlan({ workstream: 'Old draft', version: 2 })
    const winningPlan = makePlan({
      workstream: 'Other tab plan',
      waitingTask: 'Reply to review comments',
      resumeNote: 'Pick up after the agent replies',
      version: 3,
    })
    reject('sessions.putAgentPlan', { status: 409, code: 'stale_version', details: { current: winningPlan } })

    const { user } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={4} plan={plan} lifecycle="running" />,
    )

    await openPanel(user)
    await user.clear(screen.getByLabelText('Workstream'))
    await user.type(screen.getByLabelText('Workstream'), 'My unsaved edit')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))

    await screen.findByText('Another tab saved a newer plan')
    expect(screen.getByLabelText('Workstream')).toHaveValue('Other tab plan')
    expect(screen.getByLabelText('Useful task while waiting')).toHaveValue('Reply to review comments')
    expect(screen.getByLabelText('Resume note')).toHaveValue('Pick up after the agent replies')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    // No second write sent to overwrite the plan that already won.
    expect(mockApi.sessions.putAgentPlan).toHaveBeenCalledTimes(1)
  })

  it('Return to my task closes the panel without navigation or transition', async () => {
    const { user, router } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />,
      { route: '/focus/focus-session' },
    )

    await openPanel(user)
    await user.type(screen.getByLabelText('Workstream'), 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Return to my task' }))

    expect(screen.queryByLabelText('Workstream')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waiting on an agent?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/focus/focus-session')
    expect(mockApi.sessions.putAgentPlan).not.toHaveBeenCalled()
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()
  })

  it('screen-free break posts transition pause with reason planned break and Focus shows Paused', async () => {
    const session = makeSession({ id: 'focus-session', version: 6, agentPlan: null })
    const server = mockSessionServer(session)
    server.resolveNextTransitionWith({
      ...session,
      lifecycle: 'paused',
      version: 7,
      currentPauseStartedAt: session.serverNow,
    })

    const { user } = renderWithProviders(<BreakHarness sessionId={session.id} />)

    await screen.findByRole('button', { name: 'Pause' }) // TransitionControls has loaded the live session
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: 'Take a screen-free break' }))

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, {
        expectedVersion: 6,
        type: 'pause',
        reason: 'planned break',
      }),
    )

    await screen.findByText('Paused')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('no input named /token|key|output|log/i exists', async () => {
    const { user } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />,
    )
    await openPanel(user)

    expect(screen.queryByRole('textbox', { name: /token|key|output|log/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /token|key|output|log/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/token|key|output|log/i)).not.toBeInTheDocument()
  })

  it('checkpoint defaults to end_of_block', async () => {
    const { user } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />,
    )
    await openPanel(user)

    const trigger = screen.getByRole('combobox', { name: 'Next review checkpoint' })
    expect(trigger).toHaveTextContent('End of this block')
  })

  it('a 201-character field is blocked', async () => {
    const { user } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />,
    )
    await openPanel(user)

    const workstream = screen.getByLabelText('Workstream')
    await user.type(workstream, 'a'.repeat(201))

    expect((workstream as HTMLInputElement).value).toHaveLength(200)
  })
})
