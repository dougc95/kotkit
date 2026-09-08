import { Link } from 'react-router'

/**
 * The router's `errorElement`. Deliberately does not call `useRouteError()`
 * — the app-shell spec's "Implementation details are not user-facing"
 * requirement means this screen must never render an error message, a
 * stack trace, a request id or any other diagnostic detail, however the
 * route failed.
 */
export function RouteError() {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>
        <Link to="/today">Go to Today</Link>
      </p>
    </main>
  )
}
