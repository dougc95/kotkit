import { createContext, useContext, type ReactNode } from 'react'
import type { MeResponseValue } from '@attention-lab/shared'

import { useMe } from '../lib/query/hooks.js'
import { Button } from '../ui/Button.js'

/**
 * The acting principal's identity, realm, timezone and preferences (task
 * 7.1.2), read once at boot from `GET /me` and made available to every
 * screen via `useMeContext()`. A plain subset of `MeResponseValue` — every
 * field on the wire, nothing added.
 */
export type MeContextValue = Pick<
  MeResponseValue,
  'principalId' | 'identityMode' | 'realm' | 'timezone' | 'preferences' | 'demoClockOffsetSeconds'
>

const MeContext = createContext<MeContextValue | null>(null)

/** Reads the value `AppBootstrap` provides once `/me` has resolved. Throws outside its tree — every screen renders inside `AppBootstrap`, so this should never fire outside a test that forgot to wrap it. */
export function useMeContext(): MeContextValue {
  const value = useContext(MeContext)
  if (value === null) {
    throw new Error('useMeContext must be used within AppBootstrap')
  }
  return value
}

export interface AppBootstrapProps {
  readonly children: ReactNode
}

/**
 * Gates the whole app on `GET /me` (task 7.1.2; mounted in Root.tsx inside
 * `SessionModeProvider`, 7.4.2 — see that file's boot-ordering note). Three
 * states, in order:
 *
 *  - pending: a neutral `aria-busy` "Loading" region; no screen, and no
 *    default identity/realm/preferences are ever assumed.
 *  - error: "Could not reach the server" with a Retry action that calls
 *    `refetch()` — no automatic retry loop is started here, the query
 *    client's own retry policy (D15/`createQueryClient`) already covers
 *    transient network failures.
 *  - success: `children` render, wrapped in `MeContext` so `DemoBanner` and
 *    any later screen can read identity/realm/timezone/preferences without
 *    each issuing its own `/me` fetch.
 */
export function AppBootstrap({ children }: AppBootstrapProps) {
  const { data, isPending, isError, refetch, isRefetching } = useMe()

  if (isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (isError || data === undefined) {
    return (
      <div>
        <p>Could not reach the server</p>
        <Button
          onClick={() => {
            void refetch()
          }}
          disabled={isRefetching}
        >
          Retry
        </Button>
      </div>
    )
  }

  const value: MeContextValue = {
    principalId: data.principalId,
    identityMode: data.identityMode,
    realm: data.realm,
    timezone: data.timezone,
    preferences: data.preferences,
    demoClockOffsetSeconds: data.demoClockOffsetSeconds,
  }

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>
}
