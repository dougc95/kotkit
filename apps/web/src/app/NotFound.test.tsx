import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { NotFound } from './NotFound.js'

// This file now renders more than once per test file, and this harness does
// not run with `test.globals: true`, so Testing Library's framework-detected
// auto-cleanup never activates — without this, jsdom's shared `document`
// accumulates every test's elements (same reason as `Button.test.tsx`'s
// manual `cleanup()`).
afterEach(() => {
  cleanup()
})

describe('NotFound', () => {
  it('renders the heading and a Go to Today link, styled as a Button but never nested inside one', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'This page is not available' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Go to Today' })
    expect(link).toHaveAttribute('href', '/today')
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.closest('button')).toBeNull()
  })

  it('contributes no main landmark of its own, since it renders inside RailLayout\'s <main>', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('main')).toBeNull()
  })
})
