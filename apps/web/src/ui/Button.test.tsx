import { createRef, type Ref } from 'react'
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

  it('asChild forwards ref through Radix Slot onto the rendered child element (deferred Minor, Task 5)', () => {
    const ref = createRef<HTMLAnchorElement>()
    render(
      // `Button`'s `ref` prop is always typed `Ref<HTMLButtonElement>` (it
      // does not vary with `asChild`), but at runtime `asChild` hands the ref
      // to whatever child Radix's Slot renders — here an anchor. The cast
      // reflects that gap in the prop type, not a bug in the component.
      <Button asChild ref={ref as unknown as Ref<HTMLButtonElement>}>
        <a href="/x">Go</a>
      </Button>,
    )

    expect(ref.current).toBeInstanceOf(HTMLAnchorElement)
    expect(ref.current).toBe(screen.getByRole('link', { name: 'Go' }))
  })

  it('a plain Button forwards ref onto the rendered <button> element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Go</Button>)

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Go' }))
  })
})
