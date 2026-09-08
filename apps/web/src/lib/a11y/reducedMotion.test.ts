import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.js'

// This file runs in vitest's `node` project (no jsdom/window by default —
// see vitest.config.ts), matching the other pure lib/* units in 7.2/7.3.
// `usePrefersReducedMotion` calls no React hook itself (see its own file),
// so it can be exercised directly here with a stubbed `window`.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePrefersReducedMotion', () => {
  it('usePrefersReducedMotion returns true when matchMedia reduce matches', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query.includes('prefers-reduced-motion: reduce') }),
    })

    expect(usePrefersReducedMotion()).toBe(true)
  })
})

describe('index.css accessibility rules', () => {
  it('index.css contains a :focus-visible rule and a prefers-reduced-motion: reduce block', () => {
    const cssPath = fileURLToPath(new URL('../../index.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf8')

    expect(css).toMatch(/:focus-visible\s*\{/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })
})
