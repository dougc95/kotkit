import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import {
  ERROR_CODES,
  ERROR_CODE_STATUS,
  ErrorResponse,
  ExclusionReasonSchema,
  IdentityModeSchema,
  ReportedCountSchema,
} from '../../src/contracts/common.js'
import { DemoClockBody, ScenarioLoadParams, ScenarioLoadResponse } from '../../src/contracts/demo.js'
import { MeResponse, PatchPreferencesBody } from '../../src/contracts/me.js'
import { DEMO_SCENARIO_NAMES, EXCLUSION_REASONS } from '../../src/domain/types.js'

describe('contracts/common', () => {
  it('ReportedCountSchema accepts 0, 4 and null; rejects -1, 1.5 and "3"', () => {
    expect(Value.Check(ReportedCountSchema, 0)).toBe(true)
    expect(Value.Check(ReportedCountSchema, 4)).toBe(true)
    expect(Value.Check(ReportedCountSchema, null)).toBe(true)
    expect(Value.Check(ReportedCountSchema, -1)).toBe(false)
    expect(Value.Check(ReportedCountSchema, 1.5)).toBe(false)
    expect(Value.Check(ReportedCountSchema, '3')).toBe(false)
  })

  it('PatchPreferencesBody rejects an unknown key and accepts milestoneAnnouncements true (D22)', () => {
    expect(Value.Check(PatchPreferencesBody, { nope: true })).toBe(false)
    expect(Value.Check(PatchPreferencesBody, { milestoneAnnouncements: true })).toBe(true)
    expect(Value.Check(PatchPreferencesBody, {})).toBe(true)
  })

  it('DemoClockBody rejects 1.5 and rejects extra keys', () => {
    expect(Value.Check(DemoClockBody, { offsetSeconds: 1.5 })).toBe(false)
    expect(Value.Check(DemoClockBody, { offsetSeconds: 10, extra: true })).toBe(false)
    expect(Value.Check(DemoClockBody, { offsetSeconds: -300 })).toBe(true)
  })

  it('ScenarioLoadParams rejects a name outside the eight and accepts all eight; ScenarioLoadResponse accepts programId null and a uuid', () => {
    expect(Value.Check(ScenarioLoadParams, { name: 'not-a-real-scenario' })).toBe(false)
    for (const name of DEMO_SCENARIO_NAMES) {
      expect(Value.Check(ScenarioLoadParams, { name })).toBe(true)
    }
    expect(Value.Check(ScenarioLoadResponse, { programId: null })).toBe(true)
    expect(
      Value.Check(ScenarioLoadResponse, { programId: '123e4567-e89b-12d3-a456-426614174000' }),
    ).toBe(true)
  })

  it('ErrorResponse: example with fieldErrors and details {activeSessionId} passes; without requestId fails; fieldErrors with an object value fails; code "oops" fails', () => {
    const example = {
      code: 'active_session_exists',
      message: 'A session is already in progress.',
      fieldErrors: { sessionId: 'malformed_request' },
      details: { activeSessionId: 'abc-123' },
      retryable: false,
      requestId: 'req-1',
    }
    expect(Value.Check(ErrorResponse, example)).toBe(true)

    const withoutRequestId: Record<string, unknown> = { ...example }
    delete withoutRequestId['requestId']
    expect(Value.Check(ErrorResponse, withoutRequestId)).toBe(false)

    expect(
      Value.Check(ErrorResponse, { ...example, fieldErrors: { sessionId: { nested: true } } }),
    ).toBe(false)

    expect(Value.Check(ErrorResponse, { ...example, code: 'oops' })).toBe(false)
  })

  it('ERROR_CODES has 37 distinct members and ERROR_CODE_STATUS maps every code (malformed_request 400, not_found 404, stale_version 409, feed_platform_conflict 422, write_limit 429)', () => {
    expect(ERROR_CODES.length).toBe(37)
    expect(new Set(ERROR_CODES).size).toBe(37)
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_STATUS[code]).toBeDefined()
    }
    expect(ERROR_CODE_STATUS.malformed_request).toBe(400)
    expect(ERROR_CODE_STATUS.not_found).toBe(404)
    expect(ERROR_CODE_STATUS.stale_version).toBe(409)
    expect(ERROR_CODE_STATUS.feed_platform_conflict).toBe(422)
    expect(ERROR_CODE_STATUS.write_limit).toBe(429)
  })

  it('MeResponse: preferences without milestoneAnnouncements fails', () => {
    const base = {
      principalId: 'local-demo',
      identityMode: 'local-demo',
      realm: 'demo',
      timezone: 'America/Denver',
      preferences: { hideTimerDefault: false, endChime: true, visibilityContext: false },
      demoClockOffsetSeconds: 0,
    }
    expect(Value.Check(MeResponse, base)).toBe(false)
    expect(
      Value.Check(MeResponse, {
        ...base,
        preferences: { ...base.preferences, milestoneAnnouncements: false },
      }),
    ).toBe(true)
  })

  it('IdentityMode rejects "local-pilot"; ExclusionReason Lit accepts every EXCLUSION_REASONS member and rejects "other"', () => {
    expect(Value.Check(IdentityModeSchema, 'local-pilot')).toBe(false)
    expect(Value.Check(IdentityModeSchema, 'local-demo')).toBe(true)
    expect(Value.Check(IdentityModeSchema, 'real')).toBe(true)
    for (const reason of EXCLUSION_REASONS) {
      expect(Value.Check(ExclusionReasonSchema, reason)).toBe(true)
    }
    expect(Value.Check(ExclusionReasonSchema, 'other')).toBe(false)
  })
})
