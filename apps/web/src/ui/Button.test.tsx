import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button.js'

describe('Button', () => {
  it('Button primary renders type=button with data-variant=primary and its accessible name', () => {
    render(<Button>Record off-task episode</Button>)

    const button = screen.getByRole('button', { name: 'Record off-task episode' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-variant', 'primary')
  })
})
