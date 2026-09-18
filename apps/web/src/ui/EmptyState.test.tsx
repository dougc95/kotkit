import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState.js'

afterEach(() => {
  cleanup()
})

describe('EmptyState', () => {
  it('renders the message and an optional action', () => {
    render(<EmptyState action={<button type="button">Add one</button>}>Nothing recorded yet</EmptyState>)

    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument()
  })

  it('renders with no action when none is given', () => {
    render(<EmptyState>Nothing recorded yet</EmptyState>)

    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
