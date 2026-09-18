import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { absenceTier } from './valueTier.js'
import { Reported } from './Reported.js'

// This harness does not run with `test.globals: true`, so Testing Library's
// framework-detected auto-cleanup never activates (same reason as
// Button.test.tsx's manual `cleanup()`) — without this, jsdom's shared
// `document` accumulates every test's elements and `getByText` starts
// matching more than one.
afterEach(() => {
  cleanup()
})

describe('absenceTier', () => {
  it('treats every not-a-value string as absent', () => {
    for (const text of ['Not reported', 'not yet reported', 'Not finalized', '—', 'Percentage: not applicable']) {
      expect(absenceTier(text)).toBe('absent')
    }
  })

  it('treats the two uncertainty strings as uncertain', () => {
    expect(absenceTier('Unknown')).toBe('uncertain')
    expect(absenceTier('Timing uncertain')).toBe('uncertain')
  })

  it('treats "20+, capped" as a recorded measurement, not an absence', () => {
    expect(absenceTier('20+, capped')).toBe('recorded')
  })

  it('treats an explicit zero as recorded', () => {
    expect(absenceTier('0')).toBe('recorded')
    expect(absenceTier('0 min')).toBe('recorded')
  })

  it('treats the unfilled intended-output fallback string as absent', () => {
    expect(absenceTier('No intended output recorded')).toBe('absent')
  })
})

describe('Reported', () => {
  it('marks an absent value without rendering it as zero or empty', () => {
    render(<Reported>Not reported</Reported>)
    const el = screen.getByText('Not reported')
    expect(el).toHaveAttribute('data-tier', 'absent')
  })

  it('marks 20+, capped as recorded so it is never styled as a gap', () => {
    render(<Reported>20+, capped</Reported>)
    expect(screen.getByText('20+, capped')).toHaveAttribute('data-tier', 'recorded')
  })

  it('marks Unknown as uncertain, distinctly from an absent value', () => {
    render(<Reported>Unknown</Reported>)
    expect(screen.getByText('Unknown')).toHaveAttribute('data-tier', 'uncertain')
  })

  it('applies mono formatting to a recorded number', () => {
    render(<Reported mono>12</Reported>)
    const el = screen.getByText('12')
    expect(el).toHaveClass('font-mono')
    expect(el).toHaveClass('tabular-nums')
  })

  it('applies mono formatting to 20+, capped because it is a measurement', () => {
    render(<Reported mono>20+, capped</Reported>)
    expect(screen.getByText('20+, capped')).toHaveClass('font-mono')
  })

  it('never applies mono to an absent status word, even when mono is requested', () => {
    render(<Reported mono>Not reported</Reported>)
    const el = screen.getByText('Not reported')
    expect(el).not.toHaveClass('font-mono')
    expect(el).toHaveClass('font-sans')
  })

  it('never applies mono to an uncertain status word, even when mono is requested', () => {
    render(<Reported mono>Unknown</Reported>)
    const el = screen.getByText('Unknown')
    expect(el).not.toHaveClass('font-mono')
    expect(el).toHaveClass('font-sans')
  })
})
