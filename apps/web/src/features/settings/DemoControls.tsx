import { useQuery } from '@tanstack/react-query'
import type { MeResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { DemoClockPanel } from './DemoClockPanel.js'
import { ResetPanel } from './ResetPanel.js'
import { ScenarioLoader } from './ScenarioLoader.js'

/**
 * Demo-only Settings controls (task 8.9.3; identity-realm's "Demo-only
 * controls exist only in demo mode"): the demo clock (`DemoClockPanel`), the
 * scenario loader (`ScenarioLoader`) and the reset action (`ResetPanel`).
 * Renders nothing outside `local-demo` mode — never in `real` mode, however
 * this component is reached — mirroring `DemoBanner.tsx`'s own self-guard
 * rather than trusting only the caller's gate.
 *
 * Mounted by `Settings.tsx` (8.9.2) inside its own `me.identityMode ===
 * 'local-demo'`-gated `<section aria-label="Demo controls">` slot — see
 * this task's `centralWiringNeeded` for the exact edit. This file's own
 * test (`DemoControls.test.tsx`) mounts it directly, matching this
 * workflow's file-ownership rule that a slot's filler never renders through
 * its parent screen in its own tests.
 *
 * Fetches `GET /programs/current` itself (same pattern as
 * `Preferences.tsx`'s own local `EditMaterialsLink` query) purely to hand
 * `DemoClockPanel` the program/slots it needs for "Skip to Day 14" — no
 * other part of this component reads it. The query is disabled entirely
 * outside demo mode so a `DemoControls` reached in `real` mode (this file's
 * own guard test) never issues it.
 */
export interface DemoControlsProps {
  readonly me: MeResponseValue
}

export function DemoControls({ me }: DemoControlsProps) {
  const isDemoMode = me.identityMode === 'local-demo'

  const programQuery = useQuery({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
    enabled: isDemoMode,
  })

  if (!isDemoMode) {
    return null
  }

  const program = programQuery.data?.program ?? null
  const slots = programQuery.data?.slots ?? []

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-[var(--color-border)] p-4">
      <h2 className="text-base font-semibold text-[var(--color-text)]">Demonstration controls</h2>

      <DemoClockPanel me={me} program={program} slots={slots} />
      <ScenarioLoader />
      <ResetPanel />
    </div>
  )
}
