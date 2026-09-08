/**
 * The Progress screen's neutral empty state (task 8.8.1) — shown whenever
 * there is no program to report on: `GET /programs/current` resolving
 * `program: null` (D22's no-program shape, the actual behavior of the real
 * endpoint) or, defensively, a `NotFoundError` from that same call. No
 * zero-valued card is ever rendered here — there is nothing to measure yet,
 * which is a different state from "measured and zero" (CLAUDE.md: "Unknown
 * != zero").
 */
import { Link } from 'react-router'

export function ProgressEmptyState() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Progress</h1>
      <p className="mt-2 text-[var(--color-text)]">
        There is nothing to report yet. Set up your program to start your baseline.
      </p>
      <Link
        to="/setup"
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95"
      >
        Go to setup
      </Link>
    </div>
  )
}
