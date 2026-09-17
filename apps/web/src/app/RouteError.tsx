import { Link } from 'react-router'

import { Button } from '../ui/Button.js'

/**
 * The router's `errorElement`. Deliberately does not call `useRouteError()`
 * — the app-shell spec's "Implementation details are not user-facing"
 * requirement means this screen must never render an error message, a
 * stack trace, a request id or any other diagnostic detail, however the
 * route failed.
 *
 * The heading is the only text this screen ever shows, and it *is* the
 * error report to the user, so per design spec decision U15a it takes the
 * `text-attention` colour rather than plain ink — never `destructive`
 * (that colour is reserved for destructive actions, not outcomes).
 */
export function RouteError() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-medium text-attention">Something went wrong</h1>
      <Button asChild>
        <Link to="/today">Go to Today</Link>
      </Button>
    </main>
  )
}
