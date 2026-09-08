import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CreateSessionBodyValue, FinalizeBodyValue, MeResponseValue } from '@attention-lab/shared'
import { api } from './client.js'
import { ConflictError, NetworkError, NotFoundError, ValidationError } from './errors.js'

const ME: MeResponseValue = {
  principalId: 'local-demo',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'Europe/Madrid',
  preferences: {
    hideTimerDefault: false,
    endChime: true,
    visibilityContext: false,
    milestoneAnnouncements: false,
  },
  demoClockOffsetSeconds: 0,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorEnvelope(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    code: 'malformed_request',
    message: 'The request could not be validated.',
    retryable: false,
    requestId: 'req-mock',
    ...overrides,
  }
}

describe('api client', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET /api/v1/me resolves a typed MeResponse', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ME))

    const result = await api.me.get()

    expect(result).toEqual(ME)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('/api/v1/me')
    const init = call?.[1] as RequestInit
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('sessions.active maps 204 to null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await api.sessions.active()

    expect(result).toBeNull()
  })

  it('Idempotency-Key header equals the option and is byte-identical across two calls with the same key', async () => {
    const key = '123e4567-e89b-12d3-a456-426614174000'
    const createBody: CreateSessionBodyValue = { programId: '123e4567-e89b-12d3-a456-426614174001', kind: 'practice' }
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(201, {
        id: 'session-1',
        programId: createBody.programId,
        slotId: null,
        revisionId: 'rev-1',
        realm: 'demo',
        kind: 'practice',
        lifecycle: 'running',
        targetSeconds: 600,
        startedAt: '2026-09-06T09:00:00.000Z',
        endedAt: null,
        pausedSeconds: 0,
        currentPauseStartedAt: null,
        localDate: '2026-09-06',
        intendedOutput: null,
        timeSource: 'measured',
        timerQuality: 'ok',
        clockGapSeconds: null,
        completeInterval: null,
        eligible: null,
        exclusionReasons: [],
        replacementReason: null,
        version: 1,
        serverNow: '2026-09-06T09:00:00.000Z',
        timing: { elapsedSeconds: 0, remainingSeconds: 600, deadlineReached: false, isPaused: false },
        tallies: { offTask: 0, external: 0, agentChecks: 0 },
        eventCount: 0,
        events: [],
        review: {
          sessionId: 'session-1',
          episodeCount: null,
          countMethod: null,
          firstSwitch: null,
          firstSwitchMethod: null,
          externalCount: null,
          unplannedAgentChecks: null,
          mindWanderingCount: null,
          outputQuality: null,
          outputNote: null,
          reviewNote: null,
          materiallyDisrupted: null,
          disruptionNote: null,
          recallPoints: null,
          recallStartedAt: null,
          recallLockedAt: null,
          recallDelaySeconds: null,
          recallDurationSeconds: null,
          recallFlags: [],
          recallScores: null,
          recallScore: null,
          conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
          finalizedAt: null,
          version: 1,
        },
        agentPlan: null,
        amendments: [],
        }),
      ),
    )

    await api.sessions.create(createBody, { idempotencyKey: key })
    await api.sessions.create(createBody, { idempotencyKey: key })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    const firstHeaders = firstInit.headers as Record<string, string>
    const secondHeaders = secondInit.headers as Record<string, string>
    expect(firstHeaders['Idempotency-Key']).toBe(key)
    expect(secondHeaders['Idempotency-Key']).toBe(key)
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key'])
  })

  it('fetch rejection yields NetworkError with retryable=true and no value', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const failure = await api.me.get().then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(NetworkError)
    expect((failure as NetworkError).retryable).toBe(true)
    expect(failure).not.toHaveProperty('value')
  })

  it('409 yields ConflictError exposing body.details (e.g. expected/stored or activeSessionId)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        409,
        errorEnvelope({
          code: 'event_count_mismatch',
          message: 'The stored event count does not match.',
          retryable: true,
          details: { expected: 5, stored: 4 },
        }),
      ),
    )
    const finalizeBody: FinalizeBodyValue = { expectedEventCount: 5, review: {} }

    const failure = await api.sessions.finalize('session-1', finalizeBody, { idempotencyKey: 'key-1' }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(ConflictError)
    expect((failure as ConflictError).code).toBe('event_count_mismatch')
    expect((failure as ConflictError).details).toEqual({ expected: 5, stored: 4 })

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        409,
        errorEnvelope({
          code: 'active_session_exists',
          message: 'A session is already active.',
          retryable: false,
          details: { activeSessionId: 'session-9' },
        }),
      ),
    )

    const secondFailure = await api
      .sessions.create({ programId: '123e4567-e89b-12d3-a456-426614174001', kind: 'practice' }, { idempotencyKey: 'key-2' })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(secondFailure).toBeInstanceOf(ConflictError)
    expect((secondFailure as ConflictError).details).toEqual({ activeSessionId: 'session-9' })
  })

  it('422 yields ValidationError.fieldErrors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        422,
        errorEnvelope({
          code: 'baseline_times_too_close',
          message: 'The request could not be validated.',
          fieldErrors: { plannedLocalTime: 'baseline A and B must be at least one hour apart' },
        }),
      ),
    )

    const failure = await api.programs
      .putSlots('program-1', { expectedVersion: 1, slots: [{ phase: 'baseline', label: 'A', materialRef: 'Chapter 3' }] })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(failure).toBeInstanceOf(ValidationError)
    expect((failure as ValidationError).fieldErrors).toEqual({
      plannedLocalTime: 'baseline A and B must be at least one hour apart',
    })
  })

  it('404 yields NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, errorEnvelope({ code: 'not_found', message: 'Not found.', retryable: false })),
    )

    const failure = await api.sessions.get('missing-session').then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(NotFoundError)
  })

  it('no localStorage/sessionStorage/document.cookie access during any request (spies never called)', async () => {
    const localStorageGet = vi.fn()
    const sessionStorageGet = vi.fn()
    const cookieGet = vi.fn(() => '')

    vi.stubGlobal('localStorage', {
      getItem: localStorageGet,
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    vi.stubGlobal('sessionStorage', {
      getItem: sessionStorageGet,
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    vi.stubGlobal('document', {
      get cookie(): string {
        cookieGet()
        return ''
      },
      set cookie(_value: string) {
        // no-op: this test only asserts the getter is never read
      },
    })

    fetchMock.mockResolvedValueOnce(jsonResponse(200, ME))
    await api.me.get()

    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, errorEnvelope({ code: 'active_session_exists', details: { activeSessionId: 'session-1' } })),
    )
    await api.sessions
      .create({ programId: '123e4567-e89b-12d3-a456-426614174001', kind: 'practice' }, { idempotencyKey: 'key-3' })
      .catch(() => undefined)

    expect(localStorageGet).not.toHaveBeenCalled()
    expect(sessionStorageGet).not.toHaveBeenCalled()
    expect(cookieGet).not.toHaveBeenCalled()
  })
})
