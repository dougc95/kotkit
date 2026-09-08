/**
 * `putDay` — the one `PUT /programs/{id}/days/{date}` test helper (design.md
 * D16: 6.1.2 creates this once, reused by every later test that writes a
 * check-in through the real route rather than seeding rows directly).
 * Defaults `expectedVersion` to the current `GET`'s version when the caller
 * omits it, so most tests never have to track the version by hand; a caller
 * exercising a version-conflict or an edge-case path (a malformed date, a
 * terminal program, ...) supplies `expectedVersion` explicitly to skip that
 * extra `GET` round-trip.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import type { FeedRowValue } from '@attention-lab/shared'

export interface PutDayInput {
  readonly expectedVersion?: number
  readonly sleepMinutes?: number | null
  readonly stress?: number | null
  readonly mindfulnessMinutes?: number | null
  readonly note?: string
  readonly feed: readonly FeedRowValue[]
}

export interface PutDayResult {
  readonly statusCode: number
  readonly body: Record<string, unknown>
  readonly headers: LightMyRequestResponse['headers']
}

/**
 * Issues `PUT /api/v1/programs/{programId}/days/{date}` via `app.inject`.
 * When `input.expectedVersion` is omitted, this first calls the real `GET`
 * for the same program/date and reads `version` off its body — a GET that
 * itself fails (a malformed date, a program day outside 0..14, ...) throws
 * rather than silently sending `expectedVersion: undefined`, so a test that
 * needs one of those edge cases must pass `expectedVersion` explicitly.
 */
export async function putDay(
  app: FastifyInstance,
  programId: string,
  date: string,
  input: PutDayInput,
): Promise<PutDayResult> {
  let expectedVersion = input.expectedVersion

  if (expectedVersion === undefined) {
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/programs/${programId}/days/${date}`,
    })
    if (getRes.statusCode !== 200) {
      throw new Error(
        `putDay: expectedVersion omitted and GET /programs/${programId}/days/${date} did not return 200 ` +
          `(got ${getRes.statusCode}) — pass expectedVersion explicitly for this case.`,
      )
    }
    const getBody = getRes.json() as { version: number }
    expectedVersion = getBody.version
  }

  const payload: Record<string, unknown> = { expectedVersion, feed: input.feed }
  if (input.sleepMinutes !== undefined) payload.sleepMinutes = input.sleepMinutes
  if (input.stress !== undefined) payload.stress = input.stress
  if (input.mindfulnessMinutes !== undefined) payload.mindfulnessMinutes = input.mindfulnessMinutes
  if (input.note !== undefined) payload.note = input.note

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/programs/${programId}/days/${date}`,
    payload,
  })

  return { statusCode: res.statusCode, body: res.json(), headers: res.headers }
}
