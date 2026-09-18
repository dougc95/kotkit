import type { ReactNode } from 'react'
import { cn } from '../lib/cn.js'

export interface EmptyStateProps {
  readonly children: string
  readonly action?: ReactNode
  readonly className?: string
}

/**
 * The app-wide empty-state treatment (the rework spec §8 "Shell and chrome"):
 * one hairline above muted message text, with an optional action below it.
 * No card, no icon — structure comes from the hairline, matching every
 * other section boundary in the app.
 */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('border-t border-rule pt-6 text-sm text-ink-muted', className)}>
      <p>{children}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
