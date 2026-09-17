/**
 * Which of the three visual registers a rendered value belongs to.
 *
 * 'recorded'  — ink. Any number including an explicit 0, and '20+, capped',
 *               which means twenty minutes elapsed with no switch: a
 *               measurement, and arguably the best available result. It must
 *               never be styled as an absence.
 * 'absent'    — muted ink on a ruled slot. The value was never reported.
 * 'uncertain' — an amber mark. Something happened and the app failed to
 *               capture it precisely; a gap in instrumentation, not in the day.
 */
export type ValueTier = 'recorded' | 'absent' | 'uncertain'

const ABSENT = new Set(['Not reported', 'not yet reported', 'Not finalized', '—', 'Percentage: not applicable'])
const UNCERTAIN = new Set(['Unknown', 'Timing uncertain'])

export function absenceTier(text: string): ValueTier {
  if (ABSENT.has(text)) {
    return 'absent'
  }
  if (UNCERTAIN.has(text)) {
    return 'uncertain'
  }
  return 'recorded'
}
