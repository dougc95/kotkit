import { describe, expect, it } from 'vitest'

import { BLANK_COUNT_FIELDS_VALUE } from './CountFields.js'
import { toFinalizeReview } from './toFinalizeReview.js'

/**
 * task 8.4.3's named `toFinalizeReview` cases — the pure body-builder half
 * of the brief's combined 11-case list (the DOM-observable half lives in
 * `CountFields.test.tsx`). Every case builds a `CountFieldsValue` by hand;
 * none of these touch React or the DOM.
 */
describe('toFinalizeReview', () => {
  it('blank episodeCount, externalCount and mindWanderingCount are all omitted, never sent as 0', () => {
    const body = toFinalizeReview(BLANK_COUNT_FIELDS_VALUE)

    expect(body).not.toHaveProperty('episodeCount')
    expect(body).not.toHaveProperty('countMethod')
    expect(body).not.toHaveProperty('externalCount')
    expect(body).not.toHaveProperty('mindWanderingCount')
    expect(body).not.toHaveProperty('firstSwitchEstimateSeconds')
  })

  it('blank E and M are omitted while an explicit 0 E is sent as 0', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      externalCount: '0',
    })

    expect(body.externalCount).toBe(0)
    expect(body).toHaveProperty('externalCount')
    expect(body).not.toHaveProperty('mindWanderingCount')
  })

  it('an explicit "0" for episodeCount, externalCount and mindWanderingCount is sent as 0, not omitted', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '0',
      countMethod: 'retrospective',
      externalCount: '0',
      mindWanderingCount: '0',
    })

    expect(body.episodeCount).toBe(0)
    expect(body.externalCount).toBe(0)
    expect(body.mindWanderingCount).toBe(0)
    expect(body).toHaveProperty('episodeCount')
    expect(body).toHaveProperty('externalCount')
    expect(body).toHaveProperty('mindWanderingCount')
  })

  it('countMethod accompanies episodeCount only when episodeCount is set', () => {
    const withCount = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '2',
      countMethod: 'event',
    })
    expect(withCount.episodeCount).toBe(2)
    expect(withCount.countMethod).toBe('event')

    // countMethod present in state but episodeCount blank -> countMethod is
    // dropped too (a method with no accompanying count is meaningless).
    const blankCount = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '',
      countMethod: 'retrospective',
    })
    expect(blankCount).not.toHaveProperty('episodeCount')
    expect(blankCount).not.toHaveProperty('countMethod')
  })

  it('paper tally 4 -> episodeCount 4 and countMethod retrospective', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '4',
      countMethod: 'retrospective',
    })

    expect(body.episodeCount).toBe(4)
    expect(body.countMethod).toBe('retrospective')
  })

  it('estimate 6 -> firstSwitchEstimateSeconds 360', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '3',
      countMethod: 'retrospective',
      estimateMinutes: '6',
    })

    expect(body.firstSwitchEstimateSeconds).toBe(360)
  })

  it('blank estimateMinutes omits firstSwitchEstimateSeconds', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '3',
      countMethod: 'retrospective',
    })

    expect(body).not.toHaveProperty('firstSwitchEstimateSeconds')
  })

  it('an estimate is never sent when countMethod is event (the server derives first-switch from the recorded event instead)', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '2',
      countMethod: 'event',
      estimateMinutes: '6',
    })

    expect(body).not.toHaveProperty('firstSwitchEstimateSeconds')
  })

  it('an estimate is never sent when episodeCount is 0 (S = 0 always resolves to 20+, capped)', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '0',
      countMethod: 'retrospective',
      estimateMinutes: '6',
    })

    expect(body).not.toHaveProperty('firstSwitchEstimateSeconds')
  })

  it('a full 20-minute estimate lands on the wire contract boundary and is omitted rather than sent invalid', () => {
    const body = toFinalizeReview({
      ...BLANK_COUNT_FIELDS_VALUE,
      episodeCount: '3',
      countMethod: 'retrospective',
      estimateMinutes: '20',
    })

    expect(body).not.toHaveProperty('firstSwitchEstimateSeconds')
  })
})
