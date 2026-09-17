import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { ChangePracticeDuration } from './ChangePracticeDuration.js'
import { DemoControls } from './DemoControls.js'
import { Preferences } from './Preferences.js'

function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">Settings could not be loaded</p>
      <Button
        onClick={() => {
          onRetry()
        }}
      >
        Retry
      </Button>
    </div>
  )
}

/**
 * The Settings screen, mounted at `/settings` under `RailLayout`. Fetches
 * `GET /me` and hands the resolved value to `Preferences`, which owns the
 * draft state and its own mutation.
 *
 * `Preferences`' Save stays the page's one primary action; `
 * ChangePracticeDuration` composes below it with `saveVariant="secondary"`
 * so the two sections never present two primaries on the same screen
 * (the rework spec §6, "One primary per interactive surface").
 *
 * `ChangePracticeDuration` is always reachable while a program is open, so
 * it is not gated on `identityMode`. `DemoControls` mounts only in
 * local-demo mode, matching its own internal self-guard (defense-in-depth,
 * mirroring `DemoBanner.tsx`'s pattern).
 */
export function Settings() {
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: api.me.get })

  if (meQuery.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (meQuery.isError || meQuery.data === undefined) {
    return (
      <RetryNotice
        onRetry={() => {
          void meQuery.refetch()
        }}
      />
    )
  }

  const me = meQuery.data

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
      </header>

      <Preferences me={me} />

      <ChangePracticeDuration saveVariant="secondary" />

      {me.identityMode === 'local-demo' ? (
        <section aria-label="Demo controls" className="flex flex-col gap-6 border-t border-rule pt-6">
          <DemoControls me={me} />
        </section>
      ) : null}
    </div>
  )
}
