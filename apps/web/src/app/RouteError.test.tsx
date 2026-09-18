import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { RouteError } from './RouteError.js'

// This file now renders more than once per test file, and this harness does
// not run with `test.globals: true`, so Testing Library's framework-detected
// auto-cleanup never activates — without this, jsdom's shared `document`
// accumulates every test's elements (same reason as `Button.test.tsx`'s
// manual `cleanup()`).
afterEach(() => {
  cleanup()
})

describe('RouteError', () => {
  it('renders the heading and a Go to Today link, styled as a Button but never nested inside one, and no diagnostic detail', () => {
    render(
      <MemoryRouter>
        <RouteError />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Go to Today' })
    expect(link).toHaveAttribute('href', '/today')
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.closest('button')).toBeNull()

    expect(screen.queryByText(/error|stack|exception/i)).not.toBeInTheDocument()
  })

  it('renders exactly one main landmark, since it replaces the whole layout as the root errorElement', () => {
    render(
      <MemoryRouter>
        <RouteError />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
