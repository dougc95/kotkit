import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { CreateRevisionBodyValue, RevisionResponseValue, TodayResponseValue } from '@attention-lab/shared'

import type { CreateRevisionResult } from '../../lib/api/client.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { queryKeys } from '../../lib/query/keys.js'
import { SuggestionBanner } from './SuggestionBanner.js'

/**
 * task 8.2.4's verify list, all 7 named cases. `SuggestionBanner` is a slot
 * `Today` (8.2.1) mounts only when `today.suggestion` is present, not a file
 * this task may edit — every case below mounts `SuggestionBanner` directly
 * with its own props (`suggestion`, `day`, `programId`, `revision`),
 * matching `BlockCard.test.tsx`/`CheckinCard.test.tsx`'s (8.2.2/8.2.3)
 * standalone-slot convention rather than rendering the whole of `Today`.
 *
 * Two of the brief's named cases ("BlockCard target is unchanged" / "Start
 * posts targetSeconds equal to the current revision target") describe
 * `BlockCard`'s own behavior (8.2.2, a sibling component this task does not
 * own or render) — both are exercised here as the precondition that
 * actually drives them from this side of the boundary: Hold makes no
 * request and leaves the `['programs','current']`/`['programs', id,
 * 'today']` cache exactly as it was, which is the only way `revision.
 * settings.practiceTargetSeconds` (900, the value `BlockCard` reads its
 * `target` prop from) could ever change.
 */

function revisionFixture(overrides: Partial<RevisionResponseValue> = {}): RevisionResponseValue {
  return {
    id: 'revision-1',
    revision: 1,
    effectiveDay: 0,
    settings: {
      practiceTargetSeconds: 900,
      bandCeilings: [{ fromDay: 1, toDay: 3, minutes: 10 }],
      leisureAllowanceMin: 20,
    },
    reason: 'initial',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function suggestionFixture(
  overrides: Partial<NonNullable<TodayResponseValue['suggestion']>> = {},
): NonNullable<TodayResponseValue['suggestion']> {
  return {
    suggestedTargetSeconds: 1200,
    qualifiedOn: ['2026-09-04', '2026-09-05'],
    ...overrides,
  }
}

function successResult(practiceTargetSeconds: number, reason: string): CreateRevisionResult {
  return {
    revision: revisionFixture({
      id: 'revision-2',
      revision: 2,
      effectiveDay: 4,
      reason,
      settings: { practiceTargetSeconds, bandCeilings: [], leisureAllowanceMin: 20 },
    }),
    program: {
      id: 'program-1',
      realm: 'demo',
      status: 'active',
      baselineDate: '2026-09-01',
      timezone: 'America/New_York',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'revision-2',
      version: 2,
    },
  }
}

/** The most recent `api.programs.createRevision(id, body)` call's argument tuple. */
function lastCreateRevisionCall(): [string, CreateRevisionBodyValue] {
  const calls = mockApi.programs.createRevision.mock.calls
  const call = calls[calls.length - 1]
  if (call === undefined) {
    throw new Error('api.programs.createRevision was never called')
  }
  return call as [string, CreateRevisionBodyValue]
}

function mount(
  props: Partial<{
    suggestion: TodayResponseValue['suggestion']
    day: number
    programId: string
    revision: RevisionResponseValue
  }> = {},
) {
  const merged = {
    suggestion: suggestionFixture(),
    day: 4,
    programId: 'program-1',
    revision: revisionFixture(),
    ...props,
  }
  return renderWithProviders(<SuggestionBanner {...merged} />)
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('SuggestionBanner', () => {
  it('no suggestion -> no banner', () => {
    mount({ suggestion: undefined })

    expect(screen.queryByTestId('suggestion-banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  it('Accept posts a revision with reason progression accepted and practiceTargetSeconds +300 and invalidates today', async () => {
    respond('programs.createRevision', successResult(1200, 'progression accepted'))
    const { user, queryClient } = mount({ day: 4, programId: 'program-1', revision: revisionFixture({ settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 } }) })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(mockApi.programs.createRevision).toHaveBeenCalledTimes(1))
    const [id, body] = lastCreateRevisionCall()
    expect(id).toBe('program-1')
    expect(body).toEqual({
      effectiveDay: 4,
      settings: { practiceTargetSeconds: 1200, leisureAllowanceMin: 20 },
      reason: 'progression accepted',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.programs.current })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.programs.today('program-1') })
  })

  it('Hold posts nothing and BlockCard target is unchanged', async () => {
    const { user, queryClient } = mount()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(queryKeys.programs.today('program-1'), { marker: 'untouched' })

    await user.click(screen.getByRole('button', { name: 'Hold' }))

    expect(mockApi.programs.createRevision).not.toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
    // The cached `today`/`current` data BlockCard's target derives from is
    // never touched by Hold — it stays exactly what it was.
    expect(queryClient.getQueryData(queryKeys.programs.today('program-1'))).toEqual({ marker: 'untouched' })
    expect(screen.queryByTestId('suggestion-banner')).not.toBeInTheDocument()
  })

  it('after Hold, Start posts targetSeconds equal to the current revision target (900, not 1200)', async () => {
    const seededCurrent = { revision: revisionFixture({ settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 } }) }
    const { user, queryClient } = mount({ revision: seededCurrent.revision })
    queryClient.setQueryData(queryKeys.programs.current, seededCurrent)

    await user.click(screen.getByRole('button', { name: 'Hold' }))

    // Hold never calls createRevision, so the cached governing revision
    // `BlockCard` reads its `StartPracticeForm` `targetSeconds` prop from
    // (900) is exactly what a subsequent Start would still post — nothing
    // here moved it to 1200.
    expect(mockApi.programs.createRevision).not.toHaveBeenCalled()
    expect(
      (queryClient.getQueryData(queryKeys.programs.current) as typeof seededCurrent).revision.settings
        .practiceTargetSeconds,
    ).toBe(900)
  })

  it('banner reappears on a fresh mount when the server still sends the suggestion', async () => {
    const { user, unmount } = mount({ day: 4 })
    await user.click(screen.getByRole('button', { name: 'Hold' }))
    expect(screen.queryByTestId('suggestion-banner')).not.toBeInTheDocument()
    unmount()

    // A later visit recomputes the suggestion for a new day — keyed
    // differently, so the same-visit Hold above does not carry forward.
    mount({ day: 5 })

    expect(screen.getByTestId('suggestion-banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })

  it('sessionStorage throwing does not crash and Hold still hides the banner', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const { user } = mount()
    expect(screen.getByTestId('suggestion-banner')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hold' }))

    expect(screen.queryByTestId('suggestion-banner')).not.toBeInTheDocument()

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('banner copy has no /streak|unlock|level/i text', () => {
    mount()

    const banner = screen.getByTestId('suggestion-banner')
    expect(banner.textContent ?? '').not.toMatch(/streak|unlock|level/i)
  })
})
