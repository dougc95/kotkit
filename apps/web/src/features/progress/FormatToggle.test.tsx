import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// FormatToggle's only interesting behaviour is its onValueChange guard
// (C-I4), which Radix's real RadioGroup can never exercise with an
// out-of-set value — the rendered radios only ever carry the two real
// ExportFormat values. Mocking the primitive to capture the raw callback
// (mirroring Trends.test.tsx's own recharts-mock pattern) lets this test
// call it directly with a value Radix itself would never produce.
interface RadioGroupCaptured {
  onValueChange?: ((value: string) => void) | undefined
}

vi.mock('../../ui/shadcn/radio-group.js', () => {
  const captured: RadioGroupCaptured = {}

  function RadioGroup({
    children,
    onValueChange,
  }: {
    children?: ReactNode
    onValueChange?: (value: string) => void
    value?: string
    'aria-label'?: string
    className?: string
  }) {
    captured.onValueChange = onValueChange
    return <div>{children}</div>
  }
  function RadioGroupItem({ id }: { id?: string; value?: string }) {
    return <span data-testid={id} />
  }

  return { __captured: captured, RadioGroup, RadioGroupItem }
})

// eslint-disable-next-line import/first -- must follow the vi.mock('../../ui/shadcn/radio-group.js', ...) call above
import * as RadioGroupModule from '../../ui/shadcn/radio-group.js'
import { FormatToggle } from './FormatToggle.js'

function getCaptured(): RadioGroupCaptured {
  return (RadioGroupModule as unknown as { __captured: RadioGroupCaptured }).__captured
}

afterEach(() => {
  cleanup()
})

describe('FormatToggle', () => {
  it('calls onChange with a valid format', () => {
    const onChange = vi.fn()
    render(<FormatToggle value="csv" onChange={onChange} />)

    getCaptured().onValueChange?.('markdown')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('markdown')
  })

  it('ignores a value outside the closed ExportFormat set instead of casting it through (C-I4)', () => {
    const onChange = vi.fn()
    render(<FormatToggle value="csv" onChange={onChange} />)

    getCaptured().onValueChange?.('pdf')

    expect(onChange).not.toHaveBeenCalled()
  })
})
