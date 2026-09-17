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
 */
import { Link } from 'react-router'

import { Button } from '../../ui/Button.js'

export function ProgressEmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Progress</h1>
      <p className="text-ink">There is nothing to report yet. Set up your program to start your baseline.</p>
      <Button asChild className="self-start">
        <Link to="/setup">Go to setup</Link>
      </Button>
    </div>
  )
}
