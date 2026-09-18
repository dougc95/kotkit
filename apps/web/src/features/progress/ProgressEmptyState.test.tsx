import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

import { ProgressEmptyState } from './ProgressEmptyState.js'

// This harness does not run with `test.globals: true`, so Testing Library's
// framework-detected auto-cleanup never activates (DemoBanner.test.tsx's own
// rationale) — nothing here renders twice today, but the guard is cheap and
// matches every sibling test file's convention.
afterEach(() => {
  cleanup()
})

describe('ProgressEmptyState', () => {
  it('renders the heading, the message and the Setup link through ui/EmptyState (A-I1)', () => {
    render(
      <MemoryRouter>
        <ProgressEmptyState />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()

    const message = screen.getByText('There is nothing to report yet. Set up your program to start your baseline.')
    const link = screen.getByRole('link', { name: 'Go to setup' })
    expect(link).toHaveAttribute('href', '/setup')

    // Asserts the shared `ui/EmptyState` container (the rule/`text-ink-muted`
    // treatment, spec §8) rather than any shadcn internal (U16) — the message
    // and the action must both sit inside it.
    const emptyState = message.closest('.border-t.border-rule')
    expect(emptyState).not.toBeNull()
    expect(emptyState?.className).toContain('text-ink-muted')
    expect(emptyState).toContainElement(link)
  })
})
