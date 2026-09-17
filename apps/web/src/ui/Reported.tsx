import type { ReactElement } from 'react'

import { cn } from '../lib/cn.js'
import { absenceTier, type ValueTier } from './valueTier.js'

export interface ReportedProps {
  readonly children: string
  /** Tabular figures. Only for the three contexts mono is permitted in. */
  readonly mono?: boolean
  readonly className?: string
}

const TIER_CLASS: Record<ValueTier, string> = {
  recorded: 'text-ink',
  absent: 'text-ink-muted border-b border-dashed border-rule',
  uncertain: 'text-attention',
}

/**
 * Applies the three-tier value taxonomy to an already-formatted string. The
 * formatters keep returning their exact strings — this only decides how one
 * is drawn, so no text assertion anywhere in the suite is affected.
 */
export function Reported({ children, mono = false, className }: ReportedProps): ReactElement {
  const tier = absenceTier(children)
  return (
    <span
      data-tier={tier}
      className={cn(TIER_CLASS[tier], mono ? 'font-mono tabular-nums' : undefined, className)}
    >
      {children}
    </span>
  )
}
