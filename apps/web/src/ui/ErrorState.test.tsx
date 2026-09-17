import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorState } from './ErrorState.js'

afterEach(() => {
  cleanup()
})

describe('ErrorState', () => {
  it('renders the message inside the alert region with the attention treatment', () => {
    render(<ErrorState onRetry={() => {}}>Could not reach the server</ErrorState>)

    const alert = screen.getByRole('alert')
    const message = screen.getByText('Could not reach the server')
    expect(alert).toContainElement(message)
    expect(message.className).toContain('text-attention')
  })

  it('never carries the destructive treatment, on the message or the alert root', () => {
    render(<ErrorState onRetry={() => {}}>Could not reach the server</ErrorState>)

    const alert = screen.getByRole('alert')
    const message = screen.getByText('Could not reach the server')
    expect(alert.className).not.toMatch(/destructive/)
    expect(message.className).not.toMatch(/destructive/)
  })

  it('never clips the message: line-clamp-none wins over the generated line-clamp-1', () => {
    render(<ErrorState onRetry={() => {}}>Could not reach the server</ErrorState>)

    const message = screen.getByText('Could not reach the server')
    expect(message.className).toContain('line-clamp-none')
    expect(message.className).not.toContain('line-clamp-1')
  })

  it('retry button defaults to the accessible name "Retry", fires onRetry, and a custom label/disabled state are honored', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState onRetry={onRetry}>Could not reach the server</ErrorState>)

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <ErrorState onRetry={onRetry} retryLabel="Try again" retryDisabled>
        Could not reach the server
      </ErrorState>,
    )

    const customButton = screen.getByRole('button', { name: 'Try again' })
    expect(customButton).toBeDisabled()
  })
})
