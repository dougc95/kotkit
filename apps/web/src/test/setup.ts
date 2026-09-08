import '@testing-library/jest-dom/vitest'
import { randomUUID } from 'node:crypto'
import { afterEach, vi } from 'vitest'

// This file is vitest.config.ts's global `setupFiles` entry, so it loads for
// EVERY test file — the plain `.test.ts` lib units (7.2/7.3) that run in the
// `node` environment as well as the `.test.tsx` component tests that run in
// jsdom (environmentMatchGlobs). Anything that touches `window` must guard
// for its absence.

// --- crypto.randomUUID: guaranteed in both environments ---------------
// Node and jsdom both normally provide this already; the guard only covers
// an environment where it is missing or non-configurable was assumed.
try {
  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID },
      configurable: true,
    })
  } else if (typeof globalThis.crypto.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: randomUUID,
      configurable: true,
    })
  }
} catch {
  // Some hosts expose a non-configurable crypto global that already has
  // randomUUID; nothing to do in that case.
}

// --- window.matchMedia + setPrefersReducedMotion ------------------------
// A single mutable flag backs every matchMedia('(prefers-reduced-motion:
// reduce)') query. Implemented as a plain function (not vi.fn()) so the
// afterEach reset below never wipes its behavior.
let prefersReducedMotion = false

function matchMediaImpl(query: string): MediaQueryList {
  const matches = query.includes('prefers-reduced-motion: reduce') && prefersReducedMotion
  return {
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList
}

/** Test helper: flip the stubbed `prefers-reduced-motion` media query. */
export function setPrefersReducedMotion(value: boolean): void {
  prefersReducedMotion = value
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMediaImpl,
  })

  // --- URL.createObjectURL / revokeObjectURL --------------------------
  // jsdom does not implement these; stub them so export-preview style
  // screens (group 8) can be exercised without throwing.
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  }
  if (typeof window.URL.revokeObjectURL !== 'function') {
    window.URL.revokeObjectURL = vi.fn()
  }

  // --- ResizeObserver --------------------------------------------------
  // jsdom does not implement this; Radix's Switch (Preferences'
  // PreferenceSwitch, DemoControls) touches it via
  // @radix-ui/react-use-size whenever it sits inside a <form>. Several
  // Group 8 test files already added an identical local stub; this one
  // makes it available globally so any screen mounting a Switch (e.g. a
  // router-level smoke test that renders Settings) doesn't need its own.
  if (typeof window.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  }
}

afterEach(() => {
  vi.resetAllMocks()
})
