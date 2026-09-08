/**
 * BenchmarkRoute — the page shell for `/benchmark/:slotId` (task 8.3.1;
 * design.md's route map: "Benchmark Running has no route of its own — it is
 * the same /benchmark/:slotId screen after Start is pressed"). Rendered
 * inside `SessionLayout` (7.1.4, no navigation) once router.tsx's
 * `ScreenPlaceholder` for this route is replaced (see this task's
 * `centralWiringNeeded`).
 *
 * Task 8.3.3 extends this file with a `Running` branch ahead of the `Ready`
 * render below: when `GET /sessions/active` (via `lib/query/hooks.ts`'s
 * `useActiveSession`, the SAME cache entry `Ready` itself mounts) is a
 * running/paused benchmark whose `slotId` matches this route's `:slotId`
 * param, render `Running` (8.3.3) instead of `Ready` — both on the moment
 * right after Start succeeds and on a reload mid-benchmark. Every other
 * case (no active session, an active session that is not this benchmark, a
 * benchmark already `awaiting_review`/`finalized`) falls through to `Ready`
 * unchanged, which still owns its own `ActiveSessionCard` (8.2.5) branch for
 * those.
 */
import { useParams } from 'react-router'

import { useActiveSession } from '../../lib/query/hooks.js'
import { Ready } from './Ready.js'
import { Running } from './Running.js'

const RUNNING_LIFECYCLES = new Set(['running', 'paused'])

export function BenchmarkRoute() {
  const { slotId } = useParams<{ slotId: string }>()
  const activeQuery = useActiveSession()
  const active = activeQuery.data

  if (
    active != null &&
    active.kind === 'benchmark' &&
    RUNNING_LIFECYCLES.has(active.lifecycle) &&
    active.slotId === slotId
  ) {
    return <Running session={active} />
  }

  return <Ready />
}
