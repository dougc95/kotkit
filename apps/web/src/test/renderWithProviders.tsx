import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

export interface RenderWithProvidersOptions {
  /** Initial memory-router location. Defaults to '/'. */
  route?: string
  /**
   * Route table to mount `ui` into. Defaults to a single catch-all route so
   * `ui` renders regardless of `route`. Pass a real table (e.g. router.tsx's
   * `routes`) when a test needs actual route matching/navigation.
   */
  routes?: RouteObject[]
}

/**
 * A QueryClient tuned for deterministic tests: retries disabled (7.4.2's
 * real session-aware policy lands later and callers can still assert
 * against it directly in lib/query's own tests), no background refetch, no
 * garbage collection mid-test.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * Mounts `ui` inside a QueryClientProvider and a MemoryRouter at `route`.
 * Returns Testing Library's render utilities plus a ready-to-use
 * `userEvent` instance, the QueryClient (for seeding/inspecting cache
 * state) and the router (for asserting on navigation).
 */
export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const { route = '/', routes } = options
  const queryClient = createTestQueryClient()
  const routeObjects: RouteObject[] = routes ?? [{ path: '*', element: ui }]
  const router = createMemoryRouter(routeObjects, { initialEntries: [route] })

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return {
    ...utils,
    user: userEvent.setup(),
    queryClient,
    router,
  }
}
