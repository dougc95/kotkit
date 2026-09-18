import { useQuery } from '@tanstack/react-query'
import type { MeResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { DemoClockPanel } from './DemoClockPanel.js'
import { ResetPanel } from './ResetPanel.js'
import { ScenarioLoader } from './ScenarioLoader.js'

/**
 * Demo-only Settings controls: the demo clock, the scenario loader and the
 * reset action. Renders nothing outside `local-demo` mode, mirroring
 * `DemoBanner.tsx`'s own self-guard rather than trusting only the caller's
 * gate. Structure comes from hairlines between the three sub-panels, not a
 * boxed wrapper.
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
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-ink">Demonstration controls</h2>

      <DemoClockPanel me={me} program={program} slots={slots} />
      <div className="flex flex-col gap-3 border-t border-rule pt-6">
        <ScenarioLoader />
      </div>
      <div className="flex flex-col gap-3 border-t border-rule pt-6">
        <ResetPanel />
      </div>
    </div>
  )
}
