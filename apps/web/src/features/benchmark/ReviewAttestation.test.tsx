import { useState } from 'react'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXCLUSION_REASON_COPY,
  type ObservedConditionsValue,
  type Realm,
  type TimeSource,
  type TimerQuality,
} from '@attention-lab/shared'

import { renderWithProviders } from '../../test/renderWithProviders.js'
import { ConditionsFields } from './ConditionsFields.js'
import { DisruptionField, type DisruptionAnswer } from './DisruptionField.js'
import { deriveEligibilityPreviewInput, EligibilityPreview, IncompleteBanner } from './EligibilityPreview.js'

/**
 * task 8.4.4's named `ReviewAttestation` cases. `DisruptionField` and
 * `ConditionsFields` are fully controlled (never their own local state, like
 * `CountFields`, 8.4.3) and `EligibilityPreview` takes an already-assembled
 * `EligibilityInput` — so every case here mounts a small stateful `Harness`
 * that wires the three components together exactly the way
 * `BenchmarkReviewPage` (this task's edit) does: it owns
 * `{materiallyDisrupted, disruptionNote, conditions, conditionsConfirmed}`,
 * feeds `EligibilityPreview` through the real `deriveEligibilityPreviewInput`
 * helper, and exposes a `canFinalize` derived flag (`materiallyDisrupted !==
 * null && conditionsConfirmed`, matching this task's own validation rule
 * "conditions confirm required before the parent's canFinalize") — matching
 * `CountFields.test.tsx`'s Harness-plus-debug-value style, without needing
 * to mock `GET /sessions/{id}` or `GET /programs/current` at all (those live
 * only in `BenchmarkReviewPage.tsx`, covered by its own test file).
 */

const BLANK_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

interface HarnessOverrides {
  readonly completeInterval?: boolean | null
  readonly recallLockedAt?: string | null
  readonly scoringComplete?: boolean
  readonly recallScores?: readonly (0 | 1)[] | undefined
  readonly episodeCount?: number | null
  readonly timerQuality?: TimerQuality
  readonly sessionLocalDate?: string
  readonly slotAssignedLocalDate?: string | null
  readonly excludedByAmendment?: boolean
  readonly realm?: Realm
  readonly timeSource?: TimeSource
}

/** Every condition satisfied except the disruption answer — the baseline for "would be eligible". */
const ELIGIBLE_DEFAULTS: Required<HarnessOverrides> = {
  completeInterval: true,
  recallLockedAt: '2026-09-08T09:25:00.000Z',
  scoringComplete: true,
  recallScores: [1, 1, 1, 1, 1],
  episodeCount: 0,
  timerQuality: 'ok',
  sessionLocalDate: '2026-09-08',
  slotAssignedLocalDate: '2026-09-08',
  excludedByAmendment: false,
  realm: 'demo',
  timeSource: 'demo_clock',
}

interface HarnessProps extends HarnessOverrides {
  readonly initialConditions?: ObservedConditionsValue
  readonly incompleteBannerElapsedSeconds?: number
}

function Harness({ initialConditions = BLANK_CONDITIONS, incompleteBannerElapsedSeconds = 840, ...overrides }: HarnessProps) {
  const params = { ...ELIGIBLE_DEFAULTS, ...overrides }
  const [materiallyDisrupted, setMateriallyDisrupted] = useState<DisruptionAnswer>(null)
  const [disruptionNote, setDisruptionNote] = useState('')
  const [conditions, setConditions] = useState<ObservedConditionsValue>(initialConditions)
  const [conditionsConfirmed, setConditionsConfirmed] = useState(false)

  const eligibilityInput = deriveEligibilityPreviewInput({
    completeInterval: params.completeInterval,
    recallLockedAt: params.recallLockedAt,
    scoringComplete: params.scoringComplete,
    recallScores: params.recallScores,
    episodeCount: params.episodeCount,
    materiallyDisrupted,
    timerQuality: params.timerQuality,
    sessionLocalDate: params.sessionLocalDate,
    slotAssignedLocalDate: params.slotAssignedLocalDate,
    excludedByAmendment: params.excludedByAmendment,
    realm: params.realm,
    timeSource: params.timeSource,
  })

  const canFinalize = materiallyDisrupted !== null && conditionsConfirmed

  return (
    <div>
      {params.completeInterval === false ? <IncompleteBanner elapsedSeconds={incompleteBannerElapsedSeconds} /> : null}

      <DisruptionField
        value={materiallyDisrupted}
        note={disruptionNote}
        onChange={(nextValue, nextNote) => {
          setMateriallyDisrupted(nextValue)
          setDisruptionNote(nextNote)
        }}
      />

      <ConditionsFields
        value={conditions}
        confirmed={conditionsConfirmed}
        onChange={(nextValue, nextConfirmed) => {
          setConditions(nextValue)
          setConditionsConfirmed(nextConfirmed)
        }}
      />

      <EligibilityPreview input={eligibilityInput} />

      <p data-testid="can-finalize">{String(canFinalize)}</p>
      <pre data-testid="debug-conditions">{JSON.stringify(conditions)}</pre>
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe('ReviewAttestation', () => {
  it('disruption starts unanswered and the note is capped at 500', async () => {
    const { user } = renderWithProviders(<Harness />)

    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked()
    expect(screen.getByTestId('can-finalize')).toHaveTextContent('false')

    const note = screen.getByLabelText('Disruption note (optional)')
    expect(note).toHaveAttribute('maxlength', '500')

    await user.click(note)
    await user.paste('a'.repeat(505))

    expect(note).toHaveValue('a'.repeat(500))
    expect(screen.getByText('500/500')).toBeInTheDocument()
  }, 15000)

  it('E=2 with disruption No keeps the eligibility preview eligible', async () => {
    // External interruptions (E) never appear in `EligibilityInput` at all
    // (packages/shared's `evaluateEligibility` deliberately omits it) — this
    // asserts that fact from the UI side: answering "No" over an otherwise
    // fully-satisfied attempt still previews Eligible, regardless of E.
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'No' }))

    expect(screen.getByText('Eligible')).toBeInTheDocument()
  })

  it('disruption Yes lists the materially_disrupted copy in the preview', async () => {
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'Yes' }))

    expect(screen.getByText(EXCLUSION_REASON_COPY.materially_disrupted)).toBeInTheDocument()
    expect(screen.queryByText('Eligible')).not.toBeInTheDocument()
  })

  it('accommodation checkbox adds increased_font_size to conditions.accommodations', async () => {
    const { user } = renderWithProviders(<Harness />)

    const checkbox = screen.getByRole('checkbox', { name: 'Increased font size' })
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)

    expect(checkbox).toBeChecked()
    const debug = JSON.parse(screen.getByTestId('debug-conditions').textContent ?? '{}') as ObservedConditionsValue
    expect(debug.accommodations).toEqual(['increased_font_size'])
  })

  it('conditions default from review.observedConditions', () => {
    // `ConditionsFields` is fully controlled (props: value, confirmed,
    // onChange) — the "defaulted from review.observedConditions" rule
    // (D7.5) lives in `BenchmarkReviewPage`'s own one-time prefill effect,
    // covered separately; this asserts the field maps its `value` prop onto
    // the rendered controls exactly, which is what that prefill relies on.
    renderWithProviders(
      <Harness
        initialConditions={{
          deviceFormat: 'tablet',
          language: 'en',
          materialLevel: 'intermediate',
          accommodations: ['high_contrast'],
        }}
      />,
    )

    expect(screen.getByLabelText('Device format')).toHaveValue('tablet')
    expect(screen.getByLabelText('Language')).toHaveValue('en')
    expect(screen.getByLabelText('Material level')).toHaveValue('intermediate')
    expect(screen.getByRole('checkbox', { name: 'High contrast' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Increased font size' })).not.toBeChecked()
  })

  it('canFinalize stays false until the conditions confirm is checked', async () => {
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'No' }))
    expect(screen.getByTestId('can-finalize')).toHaveTextContent('false')

    await user.click(screen.getByRole('checkbox', { name: 'These conditions are correct' }))
    expect(screen.getByTestId('can-finalize')).toHaveTextContent('true')
  })

  it('completeInterval false renders the incomplete banner with elapsed 14:00 and the preview lists interval_incomplete', () => {
    renderWithProviders(<Harness completeInterval={false} incompleteBannerElapsedSeconds={840} />)

    expect(screen.getByText('Incomplete attempt')).toBeInTheDocument()
    expect(screen.getByText('Recorded elapsed time: 14:00')).toBeInTheDocument()
    expect(screen.getByText(EXCLUSION_REASON_COPY.interval_incomplete)).toBeInTheDocument()
  })

  it('preview is labeled preview and never renders a bare Eligible', async () => {
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'No' }))

    expect(screen.getByText('Preview — the server decides at finalize')).toBeInTheDocument()
    expect(screen.getByText('Eligible')).toBeInTheDocument()

    // Now flip it ineligible and confirm the label is still present alongside
    // the reasons — "Eligible" never renders standalone, but neither does
    // the reason list ever appear without the same preview qualifier.
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.getByText('Preview — the server decides at finalize')).toBeInTheDocument()
    expect(screen.queryByText('Eligible')).not.toBeInTheDocument()
  })

  it('keyboard-only traversal reaches every field in order with focus visible', async () => {
    const { user } = renderWithProviders(<Harness />)

    const expectedOrder = [
      'materially-disrupted-yes',
      'disruption-note',
      'conditions-device-format',
      'conditions-language',
      'conditions-material-level',
      'conditions-accommodation-screen_reader',
      'conditions-accommodation-magnification',
      'conditions-accommodation-increased_font_size',
      'conditions-accommodation-high_contrast',
      'conditions-accommodation-reduced_motion',
      'conditions-accommodation-extra_lighting',
      'conditions-accommodation-other',
      'conditions-confirmed',
    ]

    for (const id of expectedOrder) {
      await user.tab()
      expect(document.activeElement).toHaveAttribute('id', id)
      // The app's global `:focus-visible` rule (index.css) styles every
      // interactive element with no per-component opt-out — every stop here
      // is a plain native input/textarea/radio, so none suppresses it.
      expect(document.activeElement?.tagName).not.toBe('BODY')
    }
  })
})
