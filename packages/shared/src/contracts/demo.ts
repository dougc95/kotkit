/**
 * `POST /demo/clock`, `POST /demo/scenarios/{name}/load` and (implicitly)
 * `POST /demo/reset`, which needs no body or response schema of its own
 * (204). Demo-mode-only routes — see identity-realm's "Demo-only controls
 * exist only in demo mode".
 */
import { Type, type Static } from '@sinclair/typebox'

import { DEMO_SCENARIO_NAMES } from '../domain/types.js'
import { Lit, Obj, UuidSchema } from './common.js'

/** D35: an absolute offset from real time, not a delta applied to the current offset. */
export const DemoClockBody = Obj({
  offsetSeconds: Type.Integer(),
})
export type DemoClockBodyValue = Static<typeof DemoClockBody>

/** D22: scenario load takes no body — the UI confirms before calling this. */
export const ScenarioLoadParams = Obj({
  name: Lit(DEMO_SCENARIO_NAMES),
})
export type ScenarioLoadParamsValue = Static<typeof ScenarioLoadParams>

export const ScenarioLoadResponse = Obj({
  programId: Type.Union([UuidSchema, Type.Null()]),
})
export type ScenarioLoadResponseValue = Static<typeof ScenarioLoadResponse>
