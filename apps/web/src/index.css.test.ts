import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('index.css token contract', () => {
  it('declares every Instrument-log token', () => {
    for (const token of [
      '--color-paper: #F3F5F5',
      '--color-card: #FFFFFF',
      '--color-rule: #D5DBDA',
      '--color-ink: #16232B',
      '--color-ink-muted: #455761',
      '--color-signal: #0B5F63',
      '--color-attention: #8A5A00',
    ]) {
      expect(css).toContain(token)
    }
  })

  it('keeps the single global focus-visible rule', () => {
    expect(css).toContain(':focus-visible {')
    expect(css).toContain('outline: 2px solid var(--color-focus-ring)')
  })

  it('keeps the reduced-motion block', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('no longer declares the superseded token names', () => {
    for (const dead of ['--color-bg:', '--color-surface:', '--color-text:', '--color-primary:']) {
      expect(css).not.toContain(dead)
    }
  })
})
