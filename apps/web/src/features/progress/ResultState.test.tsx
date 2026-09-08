import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComparabilityWarningValue, ComparisonValue, ResultState as ResultStateValue } from '@attention-lab/shared'
import {
  attemptsOf,
  CAUSE_NOTE,
  computeComparison,
  DEMO_SCENARIOS,
  resolveResultState,
  RESULT_STATE_COPY,
} from '@attention-lab/shared'

import { ComparabilityWarnings } from './ComparabilityWarnings.js'
import { ComparisonFigures } from './ComparisonFigures.js'
import { ResultState } from './ResultState.js'

// This harness does not run with `test.globals: true` (see DemoBanner.test.tsx's
// header comment), so Testing Library's auto-cleanup never activates and each
// test must clean up its own render.
afterEach(() => {
  cleanup()
})

/**
 * Mirrors exactly how 8.8.1's `Progress.tsx` will mount these three
 * components (see this task's `centralWiringNeeded`): `ResultState` always,
 * `ComparisonFigures` only when `comparison` exists, `ComparabilityWarnings`
 * always (it renders nothing when its list is empty). A local test-only
 * composition, never the real `Progress` screen — per this task's brief,
 * these components are tested in isolation, not through the parent.
 */
function Section({
  resultState,
  comparison,
  warnings = [],
}: {
  readonly resultState: ResultStateValue
  readonly comparison?: ComparisonValue
  readonly warnings?: readonly ComparabilityWarningValue[]
}) {
  return (
    <>
      <ResultState resultState={resultState} />
      {comparison !== undefined ? <ComparisonFigures comparison={comparison} /> : null}
      <ComparabilityWarnings warnings={warnings} />
    </>
  )
}

/** The real 2.4.1 comparison for a named 2.8 fixture — never hand-typed, so the numbers can't drift from the fixture. */
function comparisonFor(name: 'comparable-change' | 'mixed-result' | 'zero-baseline'): ComparisonValue {
  const comparison = computeComparison(attemptsOf(DEMO_SCENARIOS[name]))
  if (comparison === null) {
    throw new Error(`comparisonFor: fixture "${name}" unexpectedly has no complete comparison`)
  }
  return comparison
}

const MORE_SWITCHES_COMPARISON: ComparisonValue = {
  s0: 3,
  s14: 5,
  absoluteChange: -2,
  percentageReduction: -66.7,
  lowBaseline: false,
  recallBaselineMean: 4,
  recallFinalMean: 4,
  firstSwitches: {
    'baseline:A': { kind: 'known', seconds: 200 },
    'baseline:B': { kind: 'known', seconds: 210 },
    'final:A': { kind: 'known', seconds: 90 },
    'final:B': { kind: 'known', seconds: 80 },
  },
  firstSwitchMeanSeconds: 145,
}

const LOW_BASELINE_COMPARISON: ComparisonValue = {
  s0: 2,
  s14: 1,
  absoluteChange: 1,
  percentageReduction: 50,
  lowBaseline: true,
  recallBaselineMean: 4,
  recallFinalMean: 4,
  firstSwitches: {
    'baseline:A': { kind: 'known', seconds: 300 },
    'baseline:B': { kind: 'none_capped' },
    'final:A': { kind: 'known', seconds: 250 },
    'final:B': { kind: 'unknown' },
  },
  firstSwitchMeanSeconds: null,
}

const NO_MEAN_COMPARISON: ComparisonValue = {
  s0: 4,
  s14: 2,
  absoluteChange: 2,
  percentageReduction: 50,
  lowBaseline: false,
  recallBaselineMean: 4,
  recallFinalMean: 4,
  firstSwitches: {
    'baseline:A': { kind: 'none_capped' },
    'baseline:B': { kind: 'none_capped' },
    'final:A': { kind: 'known', seconds: 300 },
    'final:B': { kind: 'known', seconds: 200 },
  },
  firstSwitchMeanSeconds: null,
}

const WITH_MEAN_COMPARISON: ComparisonValue = {
  ...NO_MEAN_COMPARISON,
  firstSwitches: {
    'baseline:A': { kind: 'known', seconds: 400 },
    'baseline:B': { kind: 'known', seconds: 200 },
    'final:A': { kind: 'known', seconds: 300 },
    'final:B': { kind: 'known', seconds: 300 },
  },
  firstSwitchMeanSeconds: 300,
}

describe('ResultState / ComparisonFigures / ComparabilityWarnings (8.8.2)', () => {
  it('comparable fixture renders 5 → 3, 2 fewer switches, 40% reduction and recall 4 → 4', () => {
    const comparison = comparisonFor('comparable-change')
    const resultState = DEMO_SCENARIOS['comparable-change'].expected.resultState
    if (resultState === null) throw new Error('comparable-change fixture has no expected resultState')

    render(<Section resultState={resultState} comparison={comparison} />)

    expect(screen.getByTestId('s0-s14-figure')).toHaveTextContent('5 → 3')
    expect(screen.getByTestId('change-figure')).toHaveTextContent('2 fewer switches')
    expect(screen.getByTestId('percentage-figure')).toHaveTextContent('40% reduction')
    expect(screen.getByTestId('recall-means-figure')).toHaveTextContent('recall 4 → 4')
  })

  it('mixed fixture renders the mixed copy and no success banner element', () => {
    const comparison = comparisonFor('mixed-result')
    const resultState = DEMO_SCENARIOS['mixed-result'].expected.resultState
    if (resultState === null) throw new Error('mixed-result fixture has no expected resultState')

    const { container } = render(<Section resultState={resultState} comparison={comparison} />)

    expect(screen.getByTestId('result-state-message')).toHaveTextContent(
      'Switches decreased, but recall was lower. These results are mixed.',
    )
    expect(container.querySelector('[data-testid="success-banner"]')).toBeNull()
    expect(container.textContent).not.toMatch(/success|congratulations|well done|🎉/i)
  })

  it('more switches copy is exact and contains no causal or shaming wording', () => {
    const { container } = render(<Section resultState="more_switches" comparison={MORE_SWITCHES_COMPARISON} />)

    expect(screen.getByTestId('result-state-message').textContent).toBe(RESULT_STATE_COPY.more_switches.message)
    expect(container.textContent).not.toMatch(/worse|blame|shame|fault|\bfail|caused by|your attention/i)
  })

  it('zero baseline renders not applicable and none of Infinity, NaN or 100%', () => {
    const comparison = comparisonFor('zero-baseline')
    const resultState = DEMO_SCENARIOS['zero-baseline'].expected.resultState
    if (resultState === null) throw new Error('zero-baseline fixture has no expected resultState')

    const { container } = render(<Section resultState={resultState} comparison={comparison} />)

    expect(screen.getByTestId('percentage-figure')).toHaveTextContent('not applicable')
    expect(container.textContent).not.toMatch(/Infinity|NaN|100%/)
  })

  it('S0 0 with S14 1 renders zero baseline, not more switches', () => {
    const comparison: ComparisonValue = {
      s0: 0,
      s14: 1,
      absoluteChange: -1,
      percentageReduction: null,
      lowBaseline: true,
      recallBaselineMean: 5,
      recallFinalMean: 5,
      firstSwitches: {
        'baseline:A': { kind: 'none_capped' },
        'baseline:B': { kind: 'none_capped' },
        'final:A': { kind: 'known', seconds: 100 },
        'final:B': { kind: 'known', seconds: 120 },
      },
      firstSwitchMeanSeconds: null,
    }
    // The precedence itself is 2.4.2's job (resolveResultState, tested in packages/shared);
    // calling it here just proves this S0=0/S14=1 input actually reaches this component as
    // `zero_baseline`, matching the "Zero baseline beats direction" spec scenario.
    const resultState = resolveResultState({
      baselineEligible: 2,
      finalEligible: 2,
      finalAttemptsExist: true,
      day14Finished: true,
      comparison,
    })

    render(<Section resultState={resultState} comparison={comparison} />)

    expect(screen.getByTestId('result-state-message').textContent).toBe(RESULT_STATE_COPY.zero_baseline.message)
    expect(screen.queryByText(RESULT_STATE_COPY.more_switches.message)).not.toBeInTheDocument()
  })

  it('unchanged renders the exact unchanged copy', () => {
    render(<ResultState resultState="unchanged" />)

    expect(screen.getByTestId('result-state-message').textContent).toBe('The reported switch count did not change.')
  })

  it('low baseline S0 2 / S14 1 leads with 1 fewer switch and shows the low-baseline note', () => {
    render(<ComparisonFigures comparison={LOW_BASELINE_COMPARISON} />)

    expect(screen.getByTestId('change-figure').textContent).toBe('1 fewer switch')
    expect(screen.getByTestId('low-baseline-note')).toBeInTheDocument()
  })

  it('improvement headline contains fewer reported switches and the cause note is present', () => {
    const comparison = comparisonFor('comparable-change')

    render(<Section resultState="improvement_maintained_recall" comparison={comparison} />)

    expect(screen.getByTestId('result-state-headline')).toHaveTextContent('Fewer reported switches')
    expect(screen.getByTestId('cause-note')).toHaveTextContent(CAUSE_NOTE)
  })

  it('missing final renders insufficient copy and no percentage', () => {
    const comparison = computeComparison(attemptsOf(DEMO_SCENARIOS['missing-final']))
    expect(comparison).toBeNull()
    const resultState = DEMO_SCENARIOS['missing-final'].expected.resultState
    if (resultState === null) throw new Error('missing-final fixture has no expected resultState')

    const { container } = render(<Section resultState={resultState} />)

    expect(screen.getByTestId('result-state-message')).toHaveTextContent(
      'There is not enough comparable data for the full comparison.',
    )
    expect(screen.queryByTestId('comparison-figures')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/%/)
  })

  it('language warning names language and the comparison is still rendered', () => {
    const comparison = comparisonFor('comparable-change')
    const warning: ComparabilityWarningValue = {
      label: 'B',
      field: 'language',
      baseline: 'en',
      final: 'es',
      message: 'Language differs between baseline B (en) and final B (es).',
    }

    render(<Section resultState="improvement_maintained_recall" comparison={comparison} warnings={[warning]} />)

    expect(screen.getByTestId('warning-B-language')).toHaveTextContent('Language')
    expect(screen.getByTestId('s0-s14-figure')).toHaveTextContent('5 → 3')
  })

  it('rendered text never matches /attention \\+|attention score|confidence interval|significan/i', () => {
    const improvement = comparisonFor('comparable-change')
    const mixed = comparisonFor('mixed-result')

    const { container } = render(
      <>
        <Section resultState="improvement_maintained_recall" comparison={improvement} />
        <Section resultState="fewer_switches_lower_recall" comparison={mixed} />
        <Section resultState="more_switches" comparison={MORE_SWITCHES_COMPARISON} />
      </>,
    )

    expect(container.textContent).not.toMatch(/attention \+|attention score|confidence interval|significan/i)
  })

  it('comparison without meanFirstSwitch (two capped, two known) renders no mean T; with it renders one', () => {
    const { unmount } = render(<ComparisonFigures comparison={NO_MEAN_COMPARISON} />)
    expect(screen.queryByTestId('mean-first-switch-figure')).not.toBeInTheDocument()
    unmount()

    render(<ComparisonFigures comparison={WITH_MEAN_COMPARISON} />)
    expect(screen.getByTestId('mean-first-switch-figure')).toHaveTextContent('Mean T 5:00')
  })
})
