import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { ChangePracticeDuration } from './ChangePracticeDuration.js'
import { DemoControls } from './DemoControls.js'
import { Preferences } from './Preferences.js'

function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div>
      <p>Settings could not be loaded</p>
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
 * The Settings screen (task 8.9.2), mounted at `/settings` under
 * `RailLayout` (7.1.3; see this task's `centralWiringNeeded` for the exact
 * router.tsx edit — this file does not touch that shared route table
 * itself). Fetches `GET /me` and hands the resolved value to `Preferences`
 * as a prop; `Preferences` owns the draft state, the `PATCH
 * /me/preferences` mutation and its own `GET /programs/current` fetch for
 * `EditMaterialsLink` (see that file's header comment for why that query
 * lives there rather than here).
 *
 * `ChangePracticeDuration` (8.9.5) — always reachable while a program is
 * open, per design.md D38, so it is not gated on `identityMode`.
 * `DemoControls` (8.9.3) — mounts only in local-demo mode, per that task's
 * own brief, so the slot is gated on `me.identityMode` (also matching
 * DemoControls' own internal self-guard — the double gate is intentional
 * defense-in-depth, mirroring DemoBanner.tsx's pattern).
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
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Settings</h1>
      </header>

      <Preferences me={me} />

      <ChangePracticeDuration />

      {me.identityMode === 'local-demo' ? (
        <section aria-label="Demo controls">
          <DemoControls me={me} />
        </section>
      ) : null}
    </div>
  )
}
