import { Link } from 'react-router'

/**
 * Rendered for any path under the rail layout that matches no known route
 * (the '*' leaf of the 'rail' route group in router.tsx).
 */
export function NotFound() {
  return (
    <main>
      <h1>This page is not available</h1>
      <p>
        <Link to="/today">Go to Today</Link>
      </p>
    </main>
  )
}
