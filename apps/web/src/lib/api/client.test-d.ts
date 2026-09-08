// Compile-time-only check (task 7.4.1; design.md D18-D22; identity-realm:
// "Client cannot choose the realm"). `tsc --noEmit` alone proves this file —
// it is never imported or run by vitest (the `.test-d.ts` suffix matches
// neither this workspace's `src/**/*.test.ts` nor `src/**/*.test.tsx`
// vitest project include, the same convention `contracts.typecheck.ts`
// already establishes for a plain compile-time-only file). An object
// literal passed directly to `api.programs.create` that includes a `realm`
// field must fail TypeScript's excess-property check, since
// `CreateProgramBodyValue` (built from `Obj(...)`, `additionalProperties:
// false`) never has a `realm` property — proving the client's own typed
// method signature, not just the bare contract type, rejects it.
import { api } from './client.js'

async function rejectedRealmOnCreate(): Promise<void> {
  await api.programs.create(
    {
      baselineDate: '2026-09-06',
      timezone: 'Europe/Madrid',
      practiceTargetSeconds: 600,
      // @ts-expect-error — realm is server-derived and is never accepted on a create body.
      realm: 'demo',
    },
    { idempotencyKey: '123e4567-e89b-12d3-a456-426614174000' },
  )
}

type _RejectedRealmOnCreateCheck = typeof rejectedRealmOnCreate

export type ClientTestDTypecheck = true
