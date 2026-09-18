# Attention Lab — UI rework on shadcn/ui

**Status:** implemented. Designed and approved section by section on 2026-09-09; built 2026-09-16 to
2026-09-17 on branch `worktree-shadcn-rework`, forked from `fb6ea47` (the plan commit), 97 non-merge
commits ending at the Wave 2 gate `6cbdddc` (Wave 0 gate `f38dd70`, Wave 1 gate `ac66dfc`). Verified
at that commit from a fresh database container: `db:push`, typecheck, the three unit suites, the
production build and the 166-test Playwright run, with `e2e/` byte-identical to `master`. One
caveat, recorded in §12: `npm run verify:all` itself stopped at its test stage on 13 failures in
`apps/api/test/sessions/finalize-eligibility.test.ts`, which fail identically on `master` during
the evening hours when this machine's local date and the UTC date differ; the stages after it were
run individually. The visual-pass and verification notes are at the end of §12.
**Scope:** `apps/web` only. No API, schema, or contract changes. No OpenSpec spec revisions.
**Supersedes:** nothing. This is additive to the P0 implementation described in `README.md`.

---

## 1. What this changes, and what it deliberately does not

The P0 web app is functionally complete and styled with hand-rolled Tailwind v4 utilities against a
small set of CSS custom properties in `apps/web/src/index.css`. It has three shared primitives
(`Button`, `LiveRegion`, `VisuallyHidden`), eleven files importing `radix-ui` directly, three files
that each redefine their own dialog overlay and content classes, and roughly forty-five raw form
controls.

This change introduces a shadcn/ui primitive layer, replaces the token system, and reworks how each
screen composes. It does not change routes, queries, mutations, request bodies, domain functions, or
any server-derived value. Every accessible name, ARIA attribute, section label, fieldset legend and
`data-testid` is held fixed, so the Playwright acceptance and invariant suites are expected to pass
without modification. Unit tests change only where markup genuinely changes.

Two things are explicitly out of scope: dark mode (deferred — the token structure is adopted in full
so a later `.dark` block is the only work required), and any revision to the information
architecture, which would contradict the specs in `openspec/specs/`.

### Constraints inherited from the invariants

The measurement invariants in `CLAUDE.md` are not styling guidance; several of them are only
enforceable visually, and this design is where that enforcement lives.

| Invariant | How this design carries it |
|---|---|
| Unknown is not zero | The three-tier value taxonomy (§5), applied at every render site |
| No invented attention score | No composite figure, no percentage claim, no significance or confidence language anywhere in the UI |
| Improvement over perfection | No red for any outcome, no streak count, no punitive copy, no broken-streak state |
| Benchmark ≠ practice | Petrol marks the live benchmark timer specifically; practice-block durations never borrow it |
| One episode is one episode | Tally display never implies per-app counting, and never double-counts an overlapping agent check |
| Timer expiry proves nothing | No celebratory treatment at `0:00` (§4, Motion) |
| Flexible feed policy | Nothing on the check-in screen frames feed minutes as a score to minimise |
| Pending / saved / uncertain stay distinct | Three distinct treatments, never collapsed (§5) |

---

## 2. Direction

**Instrument log.** The app is a measuring instrument that keeps an honest log.

The organising conviction is the one thing that makes this product unusual: *unknown is not zero*. A
blank sleep field, an episode with an unknown first-switch time, `20+, capped`, a skipped day — these
are distinct states the app already refuses to flatten in its data. Almost every comparable product
hides missing data or silently zeroes it. So the memorable element of this design is **how it draws
what it does not know**, and everything else stays quiet in support of that.

Rejected alternatives, recorded for provenance: a typography-forward "reading room" direction
(legitimate, since the core activity is twenty minutes of sustained reading, but it pulls toward the
warm-cream-plus-serif combination that currently reads as machine-generated, and the app is mostly
forms and figures rather than prose); and shadcn's own neutral theme, tuned rather than replaced
(fastest and most conventional, but indistinguishable from any other shadcn application).

---

## 3. Colour

Light theme only. Six meaningful tokens plus white for raised surfaces. Contrast figures are WCAG
relative-luminance computations for the exact hex pairs, in the same discipline `index.css` already
follows.

| Token | Hex | Job | Contrast |
|---|---|---|---|
| `paper` | `#F3F5F5` | Page ground. Cool-neutral off-white, deliberately not cream. | — |
| `card` | `#FFFFFF` | Raised surfaces only. | — |
| `rule` | `#D5DBDA` | Hairlines and field slots. Never text. | decorative only |
| `ink` | `#16232B` | All text, and all recorded data. | ~14.7:1 on paper |
| `ink-muted` | `#455761` | Secondary text; the "not a value" mark. | ~6.9:1 on paper |
| `signal` | `#0B5F63` | Petrol. Primary actions, and anything live or being measured. | white on it ~7.4:1 |
| `attention` | `#8A5A00` | Amber. Needs-you, and uncertainty. | ~5.4:1 text, ~5.9:1 as fill |

Two rules matter more than the values.

**Recorded data is ink, not a colour.** A saved measurement gets no green badge; it is simply
written down. This removes an entire accessory and matches what a log is.

**No red for measurement outcomes, ever.** shadcn's `--destructive` is retained but scoped strictly
to destructive *actions* — "Reset demo data", "Abandon session", "Delete". More switches on Day 14
than at baseline is a result, not a failure, and renders in ink like every other result.

**An error is not a destructive action, and never takes the destructive treatment.** A 422 realm
mismatch, a 409 conflict, a failed save and a validation message all keep their existing
`role="alert"` and take the `attention` token, not red. A first plan draft reached for
`variant="destructive"` on the realm-mismatch banner; that is wrong. Red in this app marks a thing
you are about to destroy, and nothing else — which is what keeps it meaningful when it does appear.

So `attention` carries both of its stated jobs, on two different surfaces. On a **value**, amber
means the app is unsure — `Unknown`, `Timing uncertain`, applied by `<Reported>`. On a **message**,
amber means you need to do something — a validation error, "Still needed", a failed save with a
Retry beside it. Everything recorded, and everything merely informational, stays ink. The eight
result states in `ResultState.tsx` already vary neither colour nor styling; this design makes that
existing correctness legible as a decision rather than an accident.

---

## 4. Type, structure, motion

**Typefaces.** IBM Plex Sans for the interface, IBM Plex Mono for readouts. Self-hosted via pinned
`@fontsource` packages, since the app runs loopback-only with no network access. Plex is chosen
against Inter and Geist deliberately: those are the defaults in every shadcn project, and Plex was
drawn for an engineering company, has genuine tabular figures, and carries the instrument
connotation this direction is built on.

**Mono is restricted to three contexts and no others:** timer digits, the dense data tables
(`AttemptTable` and `ExactValuesTable` alike — digits must not shift in either), and tabular figures
in comparisons. Never for labels, metadata, status words, or prose containing a number, including an
inline preview line such as `First switch, preview: 6:10 (event)`. Inside a dense table the rule
still holds cell by cell: a `Not reported` or `Unknown` cell is a status word and stays sans.
`<Reported>` enforces this rather than leaving it to each call site — `mono` takes effect only on a
recorded value (U18).

Two drafting rounds both misread this rule, in opposite directions — four screen designs applied
mono to prose, and a plan reviewer read "the exact-values tables" as excluding `AttemptTable`
because `ExactValuesTable` is a literal component name. The wording above is the corrected form;
the implementation plan names the permitted sites explicitly rather than leaving it to judgement.

**Scale.** Approximately 13 / 14 / 16 / 20 / 25 px, with the timer at 56 px. Body copy caps at 72
characters.

**Prohibited typographic treatments**, being the commonest tells of generated design: all-caps
eyebrow labels; meta strings joined with middle dots; an arrow appended to button or link text;
accenting a single word in a headline. Note that `FeedTotals.tsx` already contains a middle-dot
meta string (`· Partial — a report is missing for phone or desktop`); it is rewritten as a plain
clause, and the visible string is not asserted by any test.

**Structure.** Alignment and one hairline per section boundary, with a label column against a value
column wherever data is listed. `Card` is reserved for genuinely raised things — the active-session
panel and dialogs — not used as a default wrapper. No cards inside cards. `--radius: 0.375rem`,
well under shadcn's `0.625rem` default, because a measurement record should not look pillowy.

**Motion — exactly one expressive beat.** A value crossing from pending to recorded gets a brief
settle. Nothing else animates by authored intent.

This rule was violated by the design's own first draft, in a way worth recording: shadcn's
`Skeleton` ships `animate-pulse`, so installing it would have introduced a second, continuously
running animation. The resolution is not an exemption but a simplification — **skeletons do not
pulse**. A loading placeholder renders as a static unfilled ruled slot, the same mark as "not
reported", because a value that has not arrived yet is, at that moment, not a value. `aria-busy` and
full-row placement keep "still loading" distinguishable from an absent value inside an otherwise
populated row, and neither ever resembles `0`.

There is no celebratory treatment at timer expiry. "Timer expiry never proves completion" is an
invariant, and a flourish at `0:00` would assert precisely what the app refuses to assert.

---

## 5. The three-tier value taxonomy

This is the core of the design. The four source surveys found ten distinct absence-or-uncertainty
strings already in the codebase, and they are not all the same kind of thing.

| Tier | Treatment | Strings |
|---|---|---|
| **Recorded** | ink, tabular figures | any number *including* an explicit `0`; and **`20+, capped`** |
| **Not a value** | `ink-muted` on a thin ruled underline — the blank line in a paper ledger | `Not reported`, `not yet reported`, `Not finalized`, `—`, `Percentage: not applicable`, `No intended output recorded` (U19) |
| **Uncertain** | an `attention` amber mark | `Unknown`, `Timing uncertain` |

The critical boundary is between the first two rows. **`20+, capped` is a measurement, not an
absence.** It means twenty minutes elapsed and no switch occurred, which is a finding — and arguably
the best available one. Rendering it in the same muted grey as `Not reported` would quietly demote a
good result into a gap in the data. The app currently keeps them as different strings but styles
them identically, so nothing carries the distinction visually. This makes the invariant "no switch →
`20+, capped`; episode present but time unknown → `Unknown`; these are different states" visible for
the first time.

`Unknown` sits in amber for the mirrored reason: an episode *did* occur and the app failed to
capture when. That is a gap in instrumentation, not a gap in the day, and it is the one absence
worth drawing the eye to.

`Scored 0 because blank` splits across tiers: the `0` is a real derived score and renders in ink;
the explanatory clause takes the not-a-value treatment.

### Mechanism

`format.ts` and `trendFormat.ts` keep returning their exact current strings, so every text assertion
in the suite keeps passing. They gain one exported predicate, `absenceTier(text)`. Roughly fourteen
render sites wrap their output in a new `<Reported>` component that applies the tier. Presentation
moves into components; the strings do not move at all.

Every render site is enumerated in the implementation plan. `20+, capped` in particular is named
explicitly at each site rather than left to a default, because the Progress design left it to a
default on first pass — the one value the taxonomy exists to protect.

---

## 6. Primitive layer

Installed: `button, card, input, label, textarea, checkbox, radio-group, select, switch, collapsible,
dialog, alert-dialog, alert, badge, separator, table, skeleton, tooltip`.

`radix-ui` 1.6.7 is already the unified package shadcn targets, so `migrate radix` is unnecessary.
New pinned dependencies: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, and
the two `@fontsource` packages. All are added to the `LIMITATIONS.md` "Version pins (D3)" table with
the same exact-version discipline as the existing set.

### Four integration decisions

**No `shadcn/form`, and no react-hook-form.** Every form in the app is controlled state with manual
submit handling, and the forms carry the measurement invariants — a blank input must stay `null` all
the way to the request body, which `PlanForm` and `toFinalizeReview` do explicitly today. Moving
forty-five controls onto a new form runtime risks exactly what must not break, for no visual gain.
Instead: `Label` + `Input`/`Textarea`/`Select` plus one small local `Field` component that owns id
generation and wires `aria-describedby` and `aria-invalid`.

**Per-component focus rings are stripped.** shadcn ships
`focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring` on every generated
component. This app deliberately centralises focus in a single global `:focus-visible` rule, and
`reducedMotion.test.ts` asserts that rule exists in `index.css`. Left in place, the two indicators
compete. Every generated component has its focus-visible classes removed on the way in. This also
forbids component-level focus affordances such as a hover-and-focus underline, which one screen
design proposed.

**`Button` keeps its own variant names.** The prop stays `primary | secondary | quiet` across
roughly a hundred call sites, and the component keeps emitting `data-variant`, mapped onto shadcn's
cva internals as `default | outline | ghost`. It retains `min-h-11 min-w-11` (44 px — stricter than
shadcn's `h-9` and stricter than the WCAG 2.2 AA minimum of 24 px, a choice the app already made)
and `type="button"` as the default so a stray button never submits its enclosing form.

`ButtonVariant` does **not** gain a fourth `destructive` value, which one screen design proposed:
`data-variant` values are asserted by tests, so the union stays closed and destructive
confirmations use `variant="secondary"` plus a destructive class.

The gain is `asChild`, which retires the hand-rolled `LINK_CLASSES` constant currently duplicated
across `NextAction`, `CheckinCard`, `ActiveSessionCard` and `ProgressEmptyState`. This requires real
Radix `Slot` wiring, not a prop rename — a naive implementation renders `<button><a></a></button>`,
an anchor nested inside a button, which is invalid and would break the `getByRole('link', { name:
'Go to Today' })` assertion in `NotFound`.

**`lucide-react` is used only where shadcn needs it internally** — Checkbox, Select and Dialog
import icons. Nothing decorative. The rail navigation stays text-only; its labels are already the
accessible names, and icons would add noise to a four-item list.

### One primary per interactive surface

The app-shell rule "one dominant action per screen" is machine-checked:
`TransitionControls.test.tsx:351` asserts exactly one `[data-variant="primary"]` node.

The assertion is scoped to `container.querySelectorAll(...)` — the rendered component tree — and
Radix portals dialog content to `document.body`, outside that container. A dialog's confirm button
therefore never counts against the screen beneath it. The rule is stated as **one primary per
interactive surface, and a modal is its own surface**, which is also simply true, since Radix makes
the background inert while a modal is open.

Two consequences on Today: `NextAction`'s "Block N is next" control is demoted to `quiet` (it only
moves focus to the real Start button), and `SuggestionBanner`'s "Accept" is demoted to `secondary`.
Both are variant-only changes; no accessible name or role moves.

---

## 7. Charts

Recharts, Progress screen only, enforced by a grep test in `Trends.test.tsx`.

The existing colours were not arbitrary: `#2a78d6, #eb6834, #1baf7a, #eda100, #e87ba4` are slots 1–5
of a validated reference categorical palette, with its grid and secondary-text tokens. They read as
unrelated to the app because they answer to a different system, not to none. The work is re-stepping
a validated set onto the new surface.

| Series | Hex | Provenance |
|---|---|---|
| Sleep | `#2a78d6` | reference slot 1, unchanged |
| Phone feed | `#C24E1F` | slot 2, darkened for contrast |
| Desktop feed | `#157F5C` | slot 3, re-stepped off teal and away from the `signal` token |
| Tablet feed | `#4a3aa7` | reference slot 7 — replaces the yellow, which collided with `attention` |
| Unspecified device | `#C85480` | slot 5, darkened |

Grid moves to the `rule` token `#D5DBDA`; axis ticks to `ink-muted` `#455761`.

Validated against surface `#F3F5F5`: lightness band, chroma floor, CVD separation (worst adjacent
pair ΔE 8.5 protan / 13.0 tritan), normal-vision floor (24.0), and — unlike the current set — all
five slots clear 3:1 contrast, so no relief is required. The current palette warns on three of five;
that warning is survivable only because each chart is paired with a visible exact-values table, and
not needing the relief is better than depending on it.

Two rejected candidates are recorded because their failures were not predictable by eye: a
deeper cool set failed the chroma floor and a 14.1 normal-vision separation between violet and
mulberry; a wider hue spread failed at ΔE 2.4 between green and brick under deuteranopia. Palettes
are validated with the script, never reasoned about.

The yellow had to go regardless. `#eda100` beside the `attention` token `#8A5A00` would have meant
amber signifying "uncertain" in the interface and "tablet" in a chart three inches away.

### The practice bar chart

Planned-versus-completed is a target and an actual, not two categories, so two categorical hues
miscode the relationship. The encoding becomes **the planned duration as an unfilled ruled frame,
and the completed minutes as ink filling it** — the same metaphor as the not-a-value ruled slot,
arriving independently at the other end of the app. A block not yet finished shows an empty frame
rather than a zero-height bar, which is correct, because `completedMinutes` is `null` and not `0`
until the block ends.

Both `<Bar>` elements are retained with their `dataKey`s intact, since `bar-plannedMinutes` and
`bar-completedMinutes` come from the tests' own Recharts mock keyed on `dataKey`; planned simply
renders stroke-only rather than filled.

`connectNulls={false}` and the null-never-zero datum contract are preserved exactly. An unreported
day already draws as a real gap in the line — the invariant reaching into the charts — and that
behaviour is load-bearing, not incidental.

---

## 8. Screens

Each screen group below was designed against the locked system and then adversarially critiqued
against the invariants and the test contract. All eleven critiques returned *revise*; the systemic
findings are folded into §4, §5 and §6 above, and the per-screen corrections into the implementation
plan.

**Shell and chrome.** The instrument's fixed casing, not a screen: a permanent synthetic-data label,
a plain four-item index, and a flat reading surface that never competes with what is being measured
inside it. `card` is spent only on the leave-session dialog and the boot-error alert. This group also
defines the three patterns every other screen reuses — the loading treatment (static ruled slots,
not pulsing skeletons), the retry/error treatment (`Alert`), and the empty-state treatment.

**Today.** One hairline-divided column, not a dashboard of cards; the eye travels next action → day
position → block status → the log. The only `Card` is an active session, the one genuinely live
thing. The fourteen-day track shows *position only* — past, today, ahead — and is `aria-hidden`,
because `GET /programs/{id}/today` returns no per-day history. It must not imply recorded-versus-
missing days, and it is not a streak.

**Setup.** The intake log rather than a wizard. The app's unusual conviction is stated in plain words
at the first point a blank field becomes possible — the feed-time estimate, which `PlanForm` already
omits from the request body rather than sending as `0`.

**Benchmark: ready and running.** Ready is the protocol sheet checked off before reading starts, with
the fixed `20:00` in ink because nothing is live yet; Running replaces that constant with a live
petrol countdown. That colour change is what distinguishes a benchmark from a variable-length
practice block — not a decorative marker.

**Benchmark: recall and scoring.** One instrument in two states of the same slot. The container does
not change shape between blank textarea, locked sentence, and scored point, so the eye tracks
continuity rather than a page reset. "Time is up — save when you are ready" stays calm; the form
remains editable past the deadline.

**Benchmark review and finalize.** The densest form in the app, read as one continuous log entry:
Recall → Counts → Disruption and conditions → Finalize, each block opening with a plain title and a
hairline. The four first-switch preview states become visibly different for the first time. The
"Preview — the server decides at finalize" hedge stays prominent.

**Focus.** The instrument face — the one screen where the log is written in real time. Everything
defers to the countdown and to the single effortless button that writes an entry. Pause, agent plan
and sync are a quiet utility strip separated only by hairlines, never boxed. This is the screen where
punitive design would do the most damage: logging an off-task episode must never feel like confessing.

**Daily check-in.** A single ruled log page. A headline field superseded by its own detail rows keeps
its recorded number but gains a thin petrol rule, because it is the one value on screen being computed
live from what was just logged below. Nothing frames feed minutes as a score to minimise — the
flexible cross-device feed policy supersedes the original zero-feed rule and is never re-tightened.

**Practice review.** Two registers aligned column for column: what the app recorded above, what you
are attesting to below, prefilled from it. Proximity and shared column widths, rather than a box or a
label, carry the distinction between machine record and self-report.

**Progress.** The Day 14 payoff, and the screen most at risk of overclaiming. One claim at the top,
the exact figures backing it directly beneath, then progressively more granular ledgers, ending in
the one real task — export. Nothing is boxed except the literal export-file preview. The eight result
states keep identical styling. The sixteen-column attempt table keeps its horizontal scroll,
`scope="col"` headers and `tabIndex={0}` wrapper.

**Research and settings.** Research is the citation appendix, where a study's limitation is printed
with the same weight as its finding and never demoted to fine print; there is deliberately no
pagination and no discovery. Settings is the calibration panel, and its demo-only controls are the
one legitimate home for the destructive-scoped treatment.

---

## 9. Defects fixed en route

These are pre-existing and independent of the rework. They are fixed here because the rework touches
the same code, not because it causes them.

1. **`EligibilitySummary` renders an undetermined eligibility as a negative result.** `eligible` is
   typed `boolean | null`; `null` means not yet determined, and currently renders identically to
   `false` as "Not eligible". This is the unknown-collapsed-into-a-value failure the invariant set
   exists to prevent — the same class as coalescing null to `0`, in the eligibility column instead of
   a count. It becomes its own state under the not-a-value tier.
2. **Character counters are not associated with their fields.** The recall points, disruption note,
   review note, replacement reason and output note all render a counter that no `aria-describedby`
   points at. Only `OutputQualityField` wires its error correctly. The `Field` component fixes this
   structurally.
3. **`DemoClockPanel.tsx:112-119` uses a raw inline `<button>`** rather than the app's own primitive.
4. **Chart colours answer to a foreign system** (§7).
5. **Formatting is scattered:** `ComparisonFigures` builds its change and percentage text inline,
   `DailyTrend` formats stress inline, and recall means use a file-local `formatMean`. Consolidated
   into the shared formatters so the taxonomy applies uniformly.

---

## 10. Implementation sequencing

Parallelism is safe only where file ownership is disjoint. The eleven feature directories under
`src/features/` are disjoint and parallelise cleanly. `src/ui/` and `src/index.css` are shared by
everything and belong to Wave 0 alone. `src/app/` is neither: it holds shell screens that need
reworking, but every screen depends on them. It is therefore a single Wave 1 unit with one owner,
and no other Wave 1 agent may edit it.

**Wave 0 — foundation, single owner, sequential.** `shadcn init`, merging rather than overwriting
`index.css` (which holds the documented contrast baseline, the global `:focus-visible` rule and the
`prefers-reduced-motion` block); the token rename from the current `--color-*` set; `cn()`;
component installation with focus rings stripped and `Skeleton`'s pulse removed; the `Button`
adapter with real `Slot` wiring; the `Field` component; `<Reported>` and `absenceTier`; the font
packages; the pin table entries. Nothing else starts until this is typechecking and green.

Several screen critiques flagged that the new token names have no foundation in the codebase yet —
`index.css` still defines `--color-primary: #2563eb`. That is correct, and it is this wave's work.

**Wave 1 — screens, parallel, one sonnet agent per directory.** Twelve units: the eleven feature
directories, plus `src/app/` as its own single-owner unit. Each agent owns exactly one directory and
may not edit outside it. The primitive API is frozen by Wave 0, so no agent has reason to. `src/app/`
should land first or early, since it defines the loading, error and empty-state patterns the other
eleven follow.

**Wave 2 — verification, single owner, sequential.** `npm run typecheck`, `npm run test`,
`npm run e2e`, and the axe suites. Then a visual pass against the real running app, which is the only
way to catch the layout errors a validator cannot.

Every wave is Sonnet-driven, as is the survey and design work that produced this document.

## 11. Verification

- `npm run verify:all` must pass: fresh database container, `db:push`, typecheck, test, build, e2e.
- The Playwright acceptance and invariant suites must pass **unmodified**. Any change to those files
  is a signal the rework broke a contract, not that a test needed updating.
- `e2e/a11y/` — the axe, keyboard, reduced-motion and live-region suites — must pass unmodified.
- Contrast figures in this document must be recomputed against the shipped CSS, not trusted from here.
- The chart palette must be re-validated with the script against the shipped surface colour.

## 12. Open questions and risks

- **The focus ring does not clear 3:1 against two of this palette's own fills** — pure black measures
  ~2.8:1 on `signal` and ~2.5:1 on `destructive`, against 19.2:1 on paper and 21:1 on card. It does
  not bite today, because `outline-offset: 2px` paints the ring entirely outside a control's border
  box, so it renders on what surrounds the control and never on the control's own fill, and no
  screen nests a focusable control inside a signal- or destructive-filled surface. Introducing such
  a surface means giving it its own ring colour. This was found by the Task 2 review recomputing the
  figures rather than trusting them; §3 originally asserted the opposite.
- **The single motion beat is asserted by nothing.** Reduced motion is tested; "only one animation
  exists" is not. If that rule matters beyond this change, it needs a test — a grep for animation
  utilities outside the approved site would do.
- **Visual regression is uncovered.** The suites assert semantics, not appearance. A screen could be
  visually broken with everything green. The Wave 2 visual pass is manual and therefore fallible.
- **`Button asChild` is the highest-risk single change**, because it touches every call site and can
  fail by producing invalid nested-interactive markup that tests may not catch in every position.
- **Font loading is new to this app.** Self-hosted `@fontsource` avoids a network dependency, and the
  weight it adds is now measured (Task 3): CSS +6.06 kB raw / +0.91 kB gzip, JS unchanged; 34 font
  files, about 417.5 kB on disk across every Unicode subset, of which an English-language browser
  downloads about 61.5 kB (three latin woff2 files), because `@fontsource` gates each subset behind
  `unicode-range`.
- **A Tailwind utility beats the global focus rule whatever its specificity.** Tailwind 4 declares
  `@layer theme, base, components, utilities`, the global `:focus-visible` outline lives in
  `@layer base`, and `outline-none` / `outline-hidden` are utilities, so one stray suppressor silently
  removes a control's only focus indicator. Task 4 shipped eight such components before its review
  caught it (U17). `conventions.test.ts` now guards `src/ui/shadcn/`, but nothing guards the rest of
  `src/`: `PreferenceSwitch.tsx`, `ScenarioLoader.tsx` and `AgentPanel.tsx` still carry `outline-none`
  from before this change and are converted in Wave 1. The guard's patterns also miss arbitrary
  variants such as `has-[:focus-visible]:` and the `outline-0` utility.

**Verification notes, 2026-09-17 (Wave 2).** Recorded so the next reader knows what each step was
worth.

- *What the suites proved.* Typecheck, 2,020 unit tests (shared 233, api 1033, web 754 before the
  Wave 2 fixes; web 772 after), the production build and the 166-test Playwright run all passed at
  every gate, with `e2e/` untouched since `b7409ea`. The final `verify:all` from a fresh container
  passed bring-up, `db:push` and typecheck, then stopped at the test stage: 13 of the 21 cases in
  `apps/api/test/sessions/finalize-eligibility.test.ts` received an unexpected `timing_deviation`.
  The same 13 fail on `master` at the same hour, and the file had passed four hours earlier; the
  fixtures anchor dates with `localDateAt(new Date(), 'UTC')`, and the failure window is the four
  evening hours in which this machine's local date (UTC−4) and the UTC date disagree. Setting
  `TZ=UTC` on the process does not clear it, so the disagreement is not the Node timezone alone.
  It is an `apps/api` test defect outside this change's scope, left for its owner; the web suite
  (772) passed in the same run, and build and Playwright were then run individually and passed. The contrast figures in §3 recomputed within
  0.05 of the shipped CSS; the chart palette re-validated `ALL CHECKS PASS` with the same worst pairs
  the table above records. The primitive layer's cost, measured against the Wave 0 post-font build:
  JS +49.85 kB raw / +17.41 kB gzip (1,112.58 kB / 325.30 kB), CSS +21.81 kB raw / +3.40 kB gzip
  (52.43 kB / 9.78 kB).
- *What only the visual pass caught.* Thirteen defects, none of which any suite could see, walked
  at 1440, 375 and 320 px across every screen in the plan's list. Four predate this rework and
  were on `master`: the Progress page scrolled sideways at every width (an `sr-only` table header
  escaping an unpositioned scroll container); the demo banner rendered as a 431 px left column beside
  the desktop rail (`RailLayout`'s `md:flex` made it a flex item); the benchmark count placeholder
  "leave blank if unknown" was cut to "leave blank" in a 112 px input, inverting the instruction; and
  the practice-review register misaligned at 320 px. Nine were this rework's own: the floating
  "Abandon session" control lost its opaque ground when it became `quiet`; Readiness kept an unstyled
  page header and a raw error branch; the daily chart's legend text wore the series colours (three
  below 4.5:1 as text — the palette was validated as marks, never as text); three native selects sat
  on card white; eight native checkboxes remained in the conditions block, browser-blue when checked;
  the check-in's "Incomplete — missing" statement was ink while Today painted the same statement
  amber; two Settings triggers were stretched; a quiet button had no hover on the white dialog; one
  live token was written as an arbitrary value. All thirteen are fixed in commits `67d2eb2`,
  `70b2a23`, `abd4806`, `f71b0f4` and `850a77e`, each re-measured in Chromium afterwards.
- *What the pass confirmed.* Exactly one petrol-filled control on every surface (a dialog counts as
  its own surface); no running animation on any screen; every absent value in the ruled slot, none
  rendered as `0` or an empty cell; the first Tab stop is "Skip to content" and every stop settles on
  one 2 px black outline; `prefers-reduced-motion` collapses every transition to effectively zero.
- *Left open, on purpose.* `font-medium` (61 uses, including every `Label` and `Button`) renders at
  400 because only Plex 400 and 600 are loaded — the approved look; loading 500 would re-weight every
  label. Button `transition-colors` includes `outline-color`, so a focus ring fades from the text
  colour to black over 150 ms. Primary `Save`/`Start` are full-width on Setup, check-in, Settings and
  Today but compact on Readiness and the practice review. With a practice session from the previous
  day still awaiting review, Today shows both the pending-review card and the new day's Start form
  (a gating rule, not a styling matter). "Day 15 of 14" appears when the demo clock runs past the
  programme.

## 13. Decision log

| # | Date | Decision |
|---|---|---|
| U1 | 2026-09-09 | Scope: primitive layer, token system and screen-level layout. IA unchanged; OpenSpec specs untouched. |
| U2 | 2026-09-09 | Light theme only. shadcn token structure adopted in full so dark is a later `.dark` block. |
| U3 | 2026-09-09 | Direction: "Instrument log". Reading-room and neutral-shadcn directions rejected, reasons in §2. |
| U4 | 2026-09-09 | Palette of six tokens plus white. Recorded data is ink; no red for any measurement outcome. |
| U5 | 2026-09-09 | IBM Plex Sans and Mono, self-hosted. Mono restricted to three named contexts. |
| U6 | 2026-09-09 | One expressive motion beat. Skeletons do not pulse; a loading placeholder is a static ruled slot. |
| U7 | 2026-09-09 | Three-tier value taxonomy. `20+, capped` is a measurement and renders in ink, never as an absence. |
| U8 | 2026-09-09 | No `shadcn/form`, no react-hook-form. A local `Field` component owns label, description and error wiring. |
| U9 | 2026-09-09 | Per-component focus rings stripped; the global `:focus-visible` rule remains the only indicator. |
| U10 | 2026-09-09 | `ButtonVariant` stays `primary \| secondary \| quiet` and keeps emitting `data-variant`. No fourth variant. |
| U11 | 2026-09-09 | One primary per interactive surface; a modal is its own surface. |
| U12 | 2026-09-09 | Chart palette re-stepped and script-validated; planned-vs-completed re-encoded as frame and fill. |
| U13 | 2026-09-09 | Five pre-existing defects fixed en route, listed in §9. |
| U14 | 2026-09-09 | Mono is permitted in both dense data tables, `AttemptTable` and `ExactValuesTable`. Clarifies §4 after a plan reviewer read the original wording as excluding the former. |
| U15 | 2026-09-09 | An error never takes the destructive treatment. Red marks a thing about to be destroyed and nothing else. Clarifies §3 after a plan draft used `variant="destructive"` on a 422 banner. |
| U15a | 2026-09-09 | Correction to U15 as first written: errors take `attention`, not neutral ink. U15's first wording banned amber alongside red, which contradicted the token's own stated "needs-you" job. Amber marks an unsure *value* and a *message* you must act on; ink is for recorded and informational content. |
| U16 | 2026-09-09 | Tests never assert on shadcn internals (`data-slot`, generated class names, primitive DOM shape). They assert visible text, role, accessible name, or the `data-tier` attribute `<Reported>` emits. |
| U17 | 2026-09-16 | Stripping focus rings also strips every `outline-none` / `outline-hidden` and every other `focus*:` variant from the generated components, because a utilities-layer outline suppressor cancels the base-layer global rule. `SelectItem` keeps a highlight on `data-[highlighted]`, the listbox's active-option state. Found by the Task 4 review. |
| U18 | 2026-09-17 | `<Reported mono>` takes effect only on a recorded value; absent and uncertain values always render sans, even under an ancestor's `font-mono`. Makes §4's "never for status words" hold inside the dense tables, which is where those cells live. Found by the Task 6 review. |
| U19 | 2026-09-17 | `No intended output recorded` joins the not-a-value tier, an eighth string. It is the null branch of a field the user never filled in, and the Focus header drew it in full ink. `None recorded` is not added, because Wave 1 replaces it with `Not reported`. |
| U20 | 2026-09-17 | The taxonomy predicate lives in `src/ui/valueTier.ts`. `reported.ts` beside `Reported.tsx` differs only in case, and on a case-insensitive filesystem `./Reported.js` resolves to the wrong file (TS1149, TS2305). |
| U21 | 2026-09-17 | Native `<select>` stays where a Playwright suite reads it natively (`selectOption`, `inputValue`: the check-in device field, the plan and settings timezones), because the suites pass unmodified. It sits on the page ground like every other field; card white is for raised surfaces only. Found by the Wave 2 visual pass. |
| U22 | 2026-09-17 | Chart legend text wears ink; only the swatch carries the series colour. The palette clears 3:1 as marks and was never validated as text (three of five fall below 4.5:1). Found by the Wave 2 contrast re-check. |
| U23 | 2026-09-17 | A statement that names what the user still owes is amber wherever it appears: "Incomplete — missing: sleep, feed" on the check-in page is the same statement as Today's "Still needed" and takes the same `attention`. A terminal state with nothing to do stays ink. Applies U15a; found by the Wave 2 visual pass. |
| U24 | 2026-09-17 | The last native checkboxes (the benchmark conditions block) become the shadcn `Checkbox` with 44 px label rows. Playwright's `check()` and label locators resolve on the Radix button exactly as they do for "Confirm timezone", so the suites stay unmodified. |
