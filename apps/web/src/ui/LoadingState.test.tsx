import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LoadingState } from './LoadingState.js'

afterEach(() => {
  cleanup()
})

describe('LoadingState', () => {
  it('renders its label inside an aria-busy region with a static (non-pulsing) placeholder row', () => {
    const { container } = render(<LoadingState>Loading</LoadingState>)

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
    expect(region?.querySelector('[data-testid="loading-state-row"]')).not.toBeNull()
    expect(container).toHaveTextContent('Loading')
  })

  it('renders `rows` placeholder slots', () => {
    const { container } = render(<LoadingState rows={3}>Loading blocks</LoadingState>)

    expect(container.querySelectorAll('[data-testid="loading-state-row"]')).toHaveLength(3)
  })
})
