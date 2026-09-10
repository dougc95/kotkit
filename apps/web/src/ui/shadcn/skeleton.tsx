import { cn } from '@/lib/cn.js'

/**
 * A loading placeholder renders as a static unfilled ruled slot, never a
 * pulse. The app permits exactly one expressive animation — a value crossing
 * from pending to recorded — and a shimmering skeleton would be a second one.
 * The slot reads as "no value here yet", which is what loading means.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('rounded-sm border-b border-dashed border-[var(--color-rule)] bg-transparent', className)}
      {...props}
    />
  )
}

export { Skeleton }
