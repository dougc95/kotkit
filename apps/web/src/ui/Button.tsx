import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual weight only. Screens (not this primitive) are responsible for
   * using exactly one 'primary' button per screen (app-shell spec, "One
   * dominant action per screen").
   */
  variant?: ButtonVariant
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
export function Button({ variant = 'primary', type = 'button', className, ...buttonProps }: ButtonProps) {
  const classes = ['inline-flex items-center justify-center gap-2', 'min-h-11 min-w-11 rounded-md px-4', 'text-sm font-medium', 'transition-colors', 'disabled:opacity-50 disabled:pointer-events-none', VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(' ')

  return <button type={type} data-variant={variant} className={classes} {...buttonProps} />
}
