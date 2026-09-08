import type { ComponentPropsWithoutRef } from 'react'

/**
 * Visually hides content while keeping it in the accessibility tree — the
 * standard "sr-only" clip pattern, not `display: none` (which would remove
 * it from assistive tech too) and not `visibility: hidden` (same problem).
 * Used to size the live region (LiveRegion.tsx) without an on-screen box.
 */
export function VisuallyHidden({ style, ...rest }: ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      {...rest}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        margin: '-1px',
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
        ...style,
      }}
    />
  )
}
