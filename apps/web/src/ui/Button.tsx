import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual weight only. Screens (not this primitive) are responsible for
   * using exactly one 'primary' button per screen (app-shell spec, "One
   * dominant action per screen").
   */
  variant?: ButtonVariant
  /**
   * Forwarded to the underlying `<button>` (React 19's ref-as-prop, no
   * `forwardRef` needed). Required by Radix's `asChild` composition
   * (`<AlertDialog.Trigger asChild><Button>…</Button></AlertDialog.Trigger>`,
   * used by TransitionControls/ResetPanel/ScenarioLoader): without it, Radix
   * never gets a real DOM handle on the trigger, and its focus management —
   * auto-focus into the opened dialog, focus-return on close — silently does
   * nothing (confirmed empirically: a keyboard Enter on "Finish early" opened
   * the AlertDialog correctly, but focus never left the trigger button at
   * all, so Tab walked past the dialog into the rest of the page instead of
   * landing on "Keep going" first — `e2e/a11y/keyboard-review.spec.ts`).
   */
  ref?: Ref<HTMLButtonElement>
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-text)] hover:brightness-95 active:brightness-90',
  secondary:
    'bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]',
  quiet: 'bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface)]',
}

/**
 * The one button primitive every screen builds on. `type="button"` by
 * default (a form's submit button opts in explicitly with `type="submit"`)
 * so a stray Button never submits a form it happens to sit inside. Focus
 * styling comes entirely from index.css's global `:focus-visible` rule —
 * this component does not suppress or duplicate it.
 */
export function Button({ variant = 'primary', type = 'button', className, ref, ...buttonProps }: ButtonProps) {
  const classes = ['inline-flex items-center justify-center gap-2', 'min-h-11 min-w-11 rounded-md px-4', 'text-sm font-medium', 'transition-colors', 'disabled:opacity-50 disabled:pointer-events-none', VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(' ')

  return <button ref={ref} type={type} data-variant={variant} className={classes} {...buttonProps} />
}
