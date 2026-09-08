import { describe, expect, it } from 'vitest'

import { tallies, type TalliedEvent } from './sessionTallies.js'

/** task 8.5.1's one D11-tally-rules case (this file's name matches the
 * brief/verify command; the pure function it tests lives in
 * `sessionTallies.ts` — see that file's header comment for why it isn't
 * named `tallies.ts`): D11's rules exercised against every combination a
 * real session could produce, in a single table. */
describe('tallies', () => {
  it('excludes voided and visibility events and exposes no total', () => {
    const events: TalliedEvent[] = [
      { type: 'off_task', voided: false },
      { type: 'off_task', voided: true }, // voided: excluded
      { type: 'external', voided: false },
      { type: 'external', voided: true }, // voided: excluded
      { type: 'agent_check', voided: false, alsoOffTask: true }, // counts toward BOTH tallies
      { type: 'agent_check', voided: false, alsoOffTask: false }, // agentChecks only
      { type: 'agent_check', voided: true, alsoOffTask: true }, // voided: excluded from both, even though alsoOffTask
      { type: 'visibility', voided: false }, // never counted, voided or not
      { type: 'visibility', voided: false, alsoOffTask: true }, // alsoOffTask is meaningless off agent_check
    ]

    const result = tallies(events)

    expect(result).toEqual({ offTask: 2, external: 1, agentChecks: 2 })
    expect(result).not.toHaveProperty('total')
    // Exactly the three D11 fields — no combined figure sits alongside them.
    expect(Object.keys(result).sort()).toEqual(['agentChecks', 'external', 'offTask'])
  })
})
