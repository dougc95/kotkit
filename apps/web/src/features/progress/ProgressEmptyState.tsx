/**
 * The Progress screen's neutral empty state (task 8.8.1) — shown whenever
 * there is no program to report on: `GET /programs/current` resolving
 * `program: null` (D22's no-program shape, the actual behavior of the real
 * endpoint) or, defensively, a `NotFoundError` from that same call. No
 * zero-valued card is ever rendered here — there is nothing to measure yet,
 * which is a different state from "measured and zero" (CLAUDE.md: "Unknown
 * != zero").
 *
 * The Setup link uses `Button asChild` (the rework spec §6) rather than a
 * hand-rolled `LINK_CLASSES`-style anchor — `asChild` renders the Radix
 * Slot's CHILD element (the real `<Link>` -> `<a>`), never a `<button>`
 * wrapping an anchor, so `getByRole('link', { name: 'Go to Setup' })` keeps
 * resolving to a real anchor with a real `href`.
 *
 * The message and the Setup action render through `ui/EmptyState` (the
 * rework spec §8's app-wide empty-state treatment: a hairline above muted
 * message text, with an optional action below it) rather than a hand-rolled
 * `<p>`/`<Button>` pair, so this screen's one empty state matches every
 * future one built the same way. The `<h1>` sits outside `EmptyState`
 * because the heading is this screen's own concern, not part of the shared
 * shell.
 */
import { Link } from 'react-router'

import { Button } from '../../ui/Button.js'
import { EmptyState } from '../../ui/EmptyState.js'

export function ProgressEmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Progress</h1>
      <EmptyState
        action={
          <Button asChild className="self-start">
            <Link to="/setup">Go to setup</Link>
          </Button>
        }
      >
        There is nothing to report yet. Set up your program to start your baseline.
      </EmptyState>
    </div>
  )
}
