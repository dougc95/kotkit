import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { RouteError } from './RouteError.js'

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
})
