import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './Button.js'

// This file now renders more than once per test file, and this harness does
// not run with `test.globals: true`, so Testing Library's framework-detected
// auto-cleanup never activates (same reason as DemoBanner.test.tsx's manual
// `cleanup()`) — without this, jsdom's shared `document` accumulates every
// test's anchors and `getByRole('link', ...)` starts matching more than one.
afterEach(() => {
  cleanup()
})

describe('Button', () => {
  it('Button primary renders type=button with data-variant=primary and its accessible name', () => {
    render(<Button>Record off-task episode</Button>)

    const button = screen.getByRole('button', { name: 'Record off-task episode' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-variant', 'primary')
  })

  it('asChild renders the child element and does not nest a button around it', () => {
    render(
      <Button asChild variant="primary">
        <a href="/today">Go to Today</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Go to Today' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.querySelector('button')).toBeNull()
    expect(link.closest('button')).toBeNull()
  })

  it('asChild does not force type=button onto a non-button child', () => {
    render(
      <Button asChild>
        <a href="/today">Go to Today</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Go to Today' })).not.toHaveAttribute('type')
  })
})
