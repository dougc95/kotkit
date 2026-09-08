import { describe, expect, it } from 'vitest'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { renderWithProviders } from './renderWithProviders.js'
import { mockApi, reject, respond } from './mockClient.js'
import { setPrefersReducedMotion } from './setup.js'

function ProvidersProbe() {
  const location = useLocation()
  const query = useQuery({ queryKey: ['probe'], queryFn: async () => 'ok' })
  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="query-data">{query.data ?? 'loading'}</span>
    </div>
  )
}

describe('renderWithProviders', () => {
  it('mounts a component inside the query and router providers at the given route', async () => {
    const { getByTestId, findByText } = renderWithProviders(<ProvidersProbe />, { route: '/today' })

    expect(getByTestId('pathname').textContent).toBe('/today')
    // The query starts 'loading' and only reaches 'ok' once TanStack Query's
    // queryFn resolves, proving QueryClientProvider actually wraps `ui`.
    const dataNode = await findByText('ok')
    expect(dataNode).toBe(getByTestId('query-data'))
  })
})

describe('mockClient', () => {
  it('respond resolves the stubbed value and reject builds the {code, message, fieldErrors, details, retryable, requestId} envelope', async () => {
    respond('me.get', { principalId: 'local-demo' })
    await expect(mockApi.me.get()).resolves.toEqual({ principalId: 'local-demo' })

    const error = reject('sessions.create', {
      status: 409,
      code: 'active_session_exists',
      details: { activeSessionId: 'session-1' },
    })

    await expect(mockApi.sessions.create()).rejects.toMatchObject({
      code: 'active_session_exists',
      status: 409,
      details: { activeSessionId: 'session-1' },
      retryable: false,
      requestId: 'mock-request-id',
    })
    expect(error.message).toContain('active_session_exists')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('setPrefersReducedMotion', () => {
  it('makes matchMedia(prefers-reduced-motion: reduce) match', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)

    setPrefersReducedMotion(true)
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)

    setPrefersReducedMotion(false)
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
  })
})
