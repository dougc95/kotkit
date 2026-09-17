import { Link } from 'react-router'

import { Button } from '../ui/Button.js'

/**
 * Rendered for any path under the rail layout that matches no known route
 * (the '*' leaf of the 'rail' route group in router.tsx).
 */
export function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-medium text-ink">This page is not available</h1>
      <Button asChild>
        <Link to="/today">Go to Today</Link>
      </Button>
    </main>
  )
}
