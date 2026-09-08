import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { VisuallyHidden } from './VisuallyHidden.js'

export interface Announcer {
  announce: (text: string) => void
}

const AnnouncerContext = createContext<Announcer | null>(null)

export interface LiveRegionProps {
  children?: ReactNode
}

/**
 * The single `aria-live="polite"` region for the whole app. Mounted once in
 * Root.tsx (7.1.1's architecture) and never again — this is the only
 * aria-live element the accessibility primitives create (DemoBanner, 7.1.2,
 * is deliberately not a live region). Descendants call `useAnnouncer()` to
 * push text into it; nothing else writes to the DOM node directly.
 */
export function LiveRegion({ children }: LiveRegionProps) {
  const [message, setMessage] = useState('')

  const announce = useCallback((text: string) => {
    setMessage(text)
  }, [])

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <VisuallyHidden>
        <div aria-live="polite">{message}</div>
      </VisuallyHidden>
    </AnnouncerContext.Provider>
  )
}

/** Reads the announcer provided by the nearest <LiveRegion>. */
export function useAnnouncer(): Announcer {
  const context = useContext(AnnouncerContext)
  if (!context) {
    throw new Error('useAnnouncer() must be called within <LiveRegion>')
  }
  return context
}
