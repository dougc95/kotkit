// D3/2.7.6 compatibility gate: assigning literals to `Static<typeof ...>` for
// two representative shared contracts (one program body, one session body)
// forces `typecheck` to compile `packages/shared/src/contracts` through this
// app's own tsconfig — under `exactOptionalPropertyTypes` — before any
// feature code depends on it. The `@ts-expect-error` proves the
// excess-property check actually fires for a caller-supplied `realm`
// (identity-realm: "Client cannot choose the realm" — every user-owned
// record's realm is stamped by the identity plugin server-side, never read
// off the wire). No runtime code: this file is never imported.
import type { Static } from '@sinclair/typebox'
import { CreateProgramBody, FinalizeBody } from '@attention-lab/shared'

const createProgramExample: Static<typeof CreateProgramBody> = {
  baselineDate: '2026-09-06',
  timezone: 'Europe/Madrid',
  practiceTargetSeconds: 600,
  leisureAllowanceMinutes: 20,
  feedEstimateMinutes: null,
}

const finalizeExample: Static<typeof FinalizeBody> = {
  expectedEventCount: 0,
  review: {
    episodeCount: null,
    materiallyDisrupted: true,
  },
}

const rejectedRealm: Static<typeof CreateProgramBody> = {
  baselineDate: '2026-09-06',
  timezone: 'Europe/Madrid',
  practiceTargetSeconds: 600,
  // @ts-expect-error — realm is server-derived and never accepted on a request body.
  realm: 'pilot',
}

type _CreateProgramCheck = typeof createProgramExample
type _FinalizeCheck = typeof finalizeExample
type _RejectedRealmCheck = typeof rejectedRealm

export type ContractsTypecheck = true
