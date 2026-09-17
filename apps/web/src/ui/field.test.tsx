import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useField } from './field.js'

// This harness does not run with `test.globals: true`, so Testing Library's
// framework-detected auto-cleanup never activates (same reason as
// Button.test.tsx's manual `cleanup()`) — without this, all six cases below
// render the same "Note" label and `getByLabelText('Note')` starts matching
// more than one element.
afterEach(cleanup)

function Probe({ description, error, required }: { description?: string; error?: string | null; required?: boolean }) {
  const field = useField({ name: 'note', description, error, required })
  return (
    <>
      <label {...field.labelProps}>Note</label>
      <textarea {...field.controlProps} />
      {field.descriptionProps ? <p {...field.descriptionProps}>{description}</p> : null}
      {field.errorProps ? <p {...field.errorProps}>{error}</p> : null}
    </>
  )
}

describe('useField', () => {
  it('associates the label with the control', () => {
    render(<Probe />)
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
  })

  it('points aria-describedby at the description when there is one', () => {
    render(<Probe description="500 characters left" />)
    const control = screen.getByLabelText('Note')
    const describedBy = control.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent('500 characters left')
  })

  it('omits aria-describedby entirely when there is neither description nor error', () => {
    render(<Probe />)
    expect(screen.getByLabelText('Note')).not.toHaveAttribute('aria-describedby')
  })

  it('describes by both description and error at once, description first', () => {
    render(<Probe description="500 characters left" error="Required" />)
    const ids = (screen.getByLabelText('Note').getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[0] as string)).toHaveTextContent('500 characters left')
    expect(document.getElementById(ids[1] as string)).toHaveTextContent('Required')
  })

  it('marks the control invalid only when there is an error', () => {
    const { rerender } = render(<Probe />)
    expect(screen.getByLabelText('Note')).not.toHaveAttribute('aria-invalid')
    rerender(<Probe error="Required" />)
    expect(screen.getByLabelText('Note')).toHaveAttribute('aria-invalid', 'true')
  })

  it('gives the error row role=alert so it is announced', () => {
    render(<Probe error="Required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })
})
