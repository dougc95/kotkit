import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { NotFound } from './NotFound.js'

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
})
