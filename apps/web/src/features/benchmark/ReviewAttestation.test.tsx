import { useState } from 'react'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

    const yesRadio = screen.getByRole('radio', { name: 'Yes' })
    const noRadio = screen.getByRole('radio', { name: 'No' })
    expect(yesRadio).not.toBeChecked()
    expect(noRadio).not.toBeChecked()
    // The shared radio-group primitive (D-I2) renders each item as a real
    // <button role="radio">, with its label a min-h-11 target — the same
    // shape Scoring.tsx's PointRow radios already use.
    expect(yesRadio.tagName).toBe('BUTTON')
    expect(noRadio.tagName).toBe('BUTTON')
    const yesLabel = screen.getByText('Yes')
    const noLabel = screen.getByText('No')
    expect(yesLabel.tagName).toBe('LABEL')
    expect(noLabel.tagName).toBe('LABEL')
    expect(yesLabel.className).toContain('min-h-11')
    expect(noLabel.className).toContain('min-h-11')
    expect(screen.getByTestId('can-finalize')).toHaveTextContent('false')

    const note = screen.getByLabelText('Disruption note (optional)')
    expect(note).toHaveAttribute('maxlength', '500')

    await user.click(note)
    await user.paste('a'.repeat(505))

    expect(note).toHaveValue('a'.repeat(500))
    expect(screen.getByText('500/500')).toBeInTheDocument()
  }, 15000)

  it('disruption note counter is linked to the textarea via aria-describedby', () => {
    renderWithProviders(<Harness />)

    const note = screen.getByLabelText('Disruption note (optional)')
    const describedById = note.getAttribute('aria-describedby')
    expect(describedById).not.toBeNull()
    expect(document.getElementById(describedById ?? '')).toHaveTextContent('0/500')
  })

  it('radios sit in a legend-named radiogroup, guard onChange to literal yes/no, and #materially-disrupted-no is the No radio', async () => {
    // DisruptionField's Yes/No radios now use the same shared shadcn
    // RadioGroup/RadioGroupItem every other group in the app does (D-I2), but
    // this one still carries its own explicit aria-labelledby pointing at the
    // fieldset's legend — unlike Scoring.tsx's PointRow, no Playwright label
    // locator here collides with a name containing "Was this session
    // materially disrupted?", so the explicit association was kept rather
    // than left to the anonymous role="radiogroup"/legend pairing. This test
    // also proves the onValueChange guard reports the literal 'yes'/'no'
    // strings (no `as` cast covering an untyped string), and pins the
    // literal #materially-disrupted-no id that e2e/benchmark-review.spec.ts
    // and e2e/recovery.spec.ts click directly.
    const onChange = vi.fn()

    function Wrapper() {
      const [value, setValue] = useState<DisruptionAnswer>(null)
      const [note, setNote] = useState('')
      return (
        <DisruptionField
          value={value}
          note={note}
          onChange={(nextValue, nextNote) => {
            onChange(nextValue, nextNote)
            setValue(nextValue)
            setNote(nextNote)
          }}
        />
      )
    }

    const { user } = renderWithProviders(<Wrapper />)

    const radiogroup = screen.getByRole('radiogroup', { name: 'Was this session materially disrupted?' })
    const noRadio = screen.getByRole('radio', { name: 'No' })
    expect(radiogroup).toContainElement(noRadio)
    expect(document.getElementById('materially-disrupted-no')).toBe(noRadio)

    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(noRadio)

    expect(onChange).toHaveBeenNthCalledWith(1, 'yes', '')
    expect(onChange).toHaveBeenNthCalledWith(2, 'no', '')
    expect(noRadio).toBeChecked()
  })

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

  it('all eight checkboxes (seven accommodations plus the confirm) are Radix controls with min-h-11 labels, toggling on click (task V5 item 10)', async () => {
    const { user } = renderWithProviders(<Harness />)

    const accommodationNames = [
      'Screen reader',
      'Magnification',
      'Increased font size',
      'High contrast',
      'Reduced motion',
      'Extra lighting',
      'Other',
    ]

    for (const name of accommodationNames) {
      const checkbox = screen.getByRole('checkbox', { name })
      // A native <input type="checkbox"> would report tagName INPUT — the
      // Radix Checkbox this converts to is a real <button role="checkbox">.
      expect(checkbox.tagName).toBe('BUTTON')
      expect(checkbox).not.toBeChecked()

      const label = screen.getByText(name)
      expect(label.tagName).toBe('LABEL')
      expect(label.className).toContain('min-h-11')

      await user.click(checkbox)
      expect(checkbox).toBeChecked()
      await user.click(checkbox)
      expect(checkbox).not.toBeChecked()
    }

    const confirmCheckbox = screen.getByRole('checkbox', { name: 'These conditions are correct' })
    expect(confirmCheckbox.tagName).toBe('BUTTON')
    const confirmLabel = screen.getByText('These conditions are correct')
    expect(confirmLabel.tagName).toBe('LABEL')
    expect(confirmLabel.className).toContain('min-h-11')

    await user.click(confirmCheckbox)
    expect(confirmCheckbox).toBeChecked()
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

    const noteField = screen.getByLabelText('Disruption note (optional)')

    const expectedStops: readonly (string | HTMLElement)[] = [
      'materially-disrupted-yes',
      noteField,
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

    for (const stop of expectedStops) {
      await user.tab()
      if (typeof stop === 'string') {
        expect(document.activeElement).toHaveAttribute('id', stop)
      } else {
        // disruption-note's id now comes from useField (Task 32) rather than
        // a hand-written string, so this stop is checked by element identity
        // instead — resolved the same way a screen reader would, through the
        // label/control pairing, not a guessed id.
        expect(document.activeElement).toBe(stop)
      }
      expect(document.activeElement?.tagName).not.toBe('BODY')
    }
  })
})
