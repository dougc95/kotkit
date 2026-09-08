import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { createQueryClient } from '../lib/query/client.js'
import { createSessionModeRef, SessionModeProvider } from '../lib/query/sessionMode.js'
import { router } from './router.js'

// One modeRef instance for the whole app, created before the QueryClient so
// createQueryClient's refetchOnWindowFocus/refetchOnReconnect policy
// functions (D15) can read modeRef.isActive() synchronously from outside
// React.
const modeRef = createSessionModeRef()
const queryClient = createQueryClient(modeRef)

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionModeProvider modeRef={modeRef}>
        <RouterProvider router={router} />
      </SessionModeProvider>
    </QueryClientProvider>
  )
}
