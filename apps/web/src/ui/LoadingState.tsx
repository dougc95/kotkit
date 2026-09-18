import { cn } from '../lib/cn.js'
import { Skeleton } from './shadcn/skeleton.js'

export interface LoadingStateProps {
  readonly children: string
  /** Number of static placeholder rows to draw below the label. Defaults to 1. */
  readonly rows?: number
  readonly className?: string
}

/**
 * The app-wide loading treatment (the rework spec §4, §8 "Shell and chrome"):
 * `aria-busy="true"` on the same element that holds the label, with a
 * static — never-pulsing — ruled placeholder row underneath, the same mark
 * as an absent value. Replaces every bare `<div aria-busy="true">Loading</div>`
 * in the app.
 */
export function LoadingState({ children, rows = 1, className }: LoadingStateProps) {
  return (
    <div aria-busy="true" className={cn('flex flex-col gap-2', className)}>
      <p className="text-sm text-ink-muted">{children}</p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} data-testid="loading-state-row" className="h-4 w-full" />
      ))}
    </div>
  )
}
