# Session handoff — Group 9 (E2E acceptance & accessibility)

**Status: Group 9 is fully complete and fully verified.** All 21 tasks (9.1.1
through 9.4.2) individually verified live, marked `[x]` in `tasks.md`, and the
full cross-spec regression (below) is clean. **The only remaining work is to
commit this and start Group 10** — see **Immediate next steps**.

`tasks.md` progress: **179/187** tasks done (Groups 1–9 complete). Only **Group 10
— Documents and handoff (8 tasks, 10.1.1–10.5.2)** remains for the whole
`build-initial-mvp` change.

## Immediate next steps for whoever picks this up

1. **Nothing from Group 9 has been committed yet.** Review `git status`/`git
   diff`, then commit (see **Files changed, uncommitted** below for the exact
   list — it should still match, since no further edits happened after
   verification finished). Follow the repo's normal commit discipline (stage
   named files, not `git add -A`; do not force-push; do not amend).
2. Start Group 10 via `/opsx:apply build-initial-mvp` (or continue directly —
   the 8 remaining tasks are documentation-only edits to README.md, CLAUDE.md,
   the three design-bundle documents, and two verification scripts; no
   application code changes are expected).
3. Once Group 10 is done and committed, this file has been fully superseded
   by the commit history and `tasks.md` — safe to delete.

## Final verification result

**PASS — clean, twice, on every check.**

- Full e2e suite (`npx playwright test -c e2e/playwright.config.ts`, no file
  filter — every project: `acceptance-dev` — Groups 7/8's dev-server-pair
  specs — and `acceptance` — Group 9's build-and-serve specs, 166 tests
  total): **166/166 passed**, twice in a row (7.8m and 7.9m).
- `npm run typecheck` (shared + api + web + e2e): clean, twice.
- `npm run build` (shared + api + web, including the real `vite build`):
  clean, twice.
- `npm run test -w @attention-lab/web`: **456/456 passed**, twice in a row
  (~22s each).

No flakiness observed in either full-suite run. (Several individual specs
*were* genuinely flaky earlier in this session before being fixed — see the
test-design bug list below — each was independently stress-run 4–12× after
its fix before being trusted; the two full-suite passes above are the final
confirmation on top of that.)

## What Group 9 covers

21 real Playwright specs run against the `acceptance` project (D37's
single-origin build-and-serve topology: `webServer` runs `npm run build -w
@attention-lab/web` then serves the compiled app + API from one Fastify
process on port 8788, `workers: 1`/`fullyParallel: false` since every spec
shares one demo principal):

- **9.1.x (9 tasks)** — full acceptance journeys: harness/helpers sanity
  (already done before this segment), new-user setup, Day-0 baseline A/B,
  Day-4 working day, comparison outcomes/guards, recovery (offline/Pending/
  Retry), timing deviation (clock-gap resolutions).
- **9.2.x (7 tasks)** — invariants: hidden tab, reload/URL-nav recovery, never-
  completed (expiry/stop-early/abandon), idempotent finalize/start, Day-8
  revision, progression suggestions, two-tabs conflict handling.
- **9.3.x (3 tasks)** — axe checks on the shell screens and every session
  screen, plus a keyboard-only practice-review walkthrough.
- **9.4.x (2 tasks)** — the countdown emits no per-second live-region churn,
  and reduced-motion disables all transitions/animations.

Every spec file: `npx playwright test -c e2e/playwright.config.ts <path>` on
its own passed at least twice in a row before being marked done (several
specs were additionally stress-run 4–12× after a fix, given real flakiness
was found and fixed along the way — see below).

## Real bugs found and fixed (app bugs)

These are genuine, previously-undiscovered defects in the shipped
application, found by driving the real UI through Playwright — not artifacts
of the test harness. Each was confirmed by reading the actual source before
fixing, per this session's own discipline.

1. **`elapsedMsForEvent` sent non-integer milliseconds** —
   `apps/web/src/lib/clock/remaining.ts`. `performance.now()`-derived elapsed
   time was never rounded before being sent as `EventInput.elapsedMs`, which
   the wire contract requires to be an integer. Every session-event
   submission (`off_task`/`external`/`agent_check`/`visibility`) made with a
   REAL (un-faked) browser clock was silently rejected by the server with 400
   `malformed_request` — this affected the app's core interruption-recording
   feature in real usage, not just tests. Fixed with `Math.round(...)`.

2. **`BlockCard` rendered a second, guaranteed-409 Start button** —
   `apps/web/src/features/today/BlockCard.tsx`. `nextPracticeBlock`
   deliberately points `isNext` at the currently-`in_progress` block (so its
   card can show something meaningful) — but `BlockCard` rendered
   `StartPracticeForm` for `isNext` regardless of the block's own status,
   showing a live "Start" control for a session that was already running.
   Fixed by gating the form on `block.status === 'not_started'` too.

3. **Clock-gap resolution silently reverted to `'uncertain'` at finalize** —
   two-sided bug, `apps/web/src/features/focus/useClockGap.ts` +
   `apps/api/src/services/review.ts`. When a gap prompt reopens from an
   already-server-stored unresolved event (no local outbox draft), `resolve()`
   skipped writing any event at all (by design, per its own doc comment) —
   and the server's `hasUnresolvedClockGap` checked *any* unresolved
   `clock_gap` event ever stored, not just the *latest* one. Result: clicking
   "Yes, it continued" correctly set `timerQuality: 'ok'` via the dedicated
   endpoint, but a later `finalize` call re-scanned events, found the
   original never-resolved row, and silently forced `timerQuality` back to
   `'uncertain'` — discarding a user's correct answer. Fixed on both sides:
   the client now always records a *new* resolved event (fresh
   `clientEventId` when there's no local draft to overwrite), and the server
   now checks only the most-recent `clock_gap` event (mirroring the client's
   own `findUnresolvedClockGap` semantics), consistent with D9's
   append-only event model.

4. **`visibility` event's `details.hidden` field was never in the wire
   contract** — `packages/shared/src/contracts/sessions.ts`.
   `EventDetailsSchema`/`EventDetailsResponseSchema` never declared `hidden`,
   and `Obj()` forces `additionalProperties: false` — so the entire opt-in
   visibility-tracking feature (D39, `preferences.visibilityContext`) was
   broken from the moment it was implemented; every such event 400'd. Added
   `hidden: Type.Optional(Type.Boolean())` to both schemas.

5. **Reload-replayed outbox events never reached the on-screen tally** —
   `apps/web/src/lib/query/sessionMode.tsx` +
   `apps/web/src/features/focus/useSessionEvents.ts`. `SessionModeProvider`'s
   boot-time `replayOnLoad` successfully flushed a buffered row to the
   server, but never invalidated/refreshed the session data a mounted
   screen was already showing, and `useSessionEvents`'s own seed-from-
   `session.events` logic only ever ran once per session id. Fixed by (a)
   writing the freshly-fetched session (`api.sessions.get`, not
   `api.sessions.active` — see the code comment for why) into both
   `sessions.byId` and, when it still names the same session,
   `sessions.active`, guarding against a race where a *different* session
   started while the replay was in flight (confirmed via a real regression
   in `useStartSession.test.tsx`); and (b) re-seeding `useSessionEvents`
   whenever the server's own `eventCount` grows, not just once per session
   id (the reducer's seed case only ever adds unseen ids, so this is safe).

6. **Radix `AlertDialog` never actually got keyboard focus on open** —
   `apps/web/src/ui/Button.tsx` (not wrapped for ref forwarding — a plain
   function component, so `<AlertDialog.Trigger asChild><Button>…` never
   gave Radix's Slot composition a real DOM handle) plus
   `apps/web/src/features/focus/TransitionControls.tsx`,
   `apps/web/src/features/settings/{ResetPanel,ScenarioLoader}.tsx` (all
   three `AlertDialog.Trigger asChild` sites in the app). Confirmed
   empirically: opening "Finish early"'s confirm dialog via keyboard left
   focus stuck on the trigger button indefinitely — Tab walked past the
   whole dialog into the rest of the page instead of landing on "Keep
   going". Fixed `Button` to accept `ref` (React 19 ref-as-prop), and — since
   a `useEffect` keyed on the open flag can itself run before the portaled
   content's DOM node exists (also confirmed empirically as a second, real
   race) — all three dialogs now focus their first button via a stable
   (`useCallback`, no deps) **callback ref**, which React calls exactly when
   the node mounts regardless of portal/effect timing.

7. **No scroll-reset on client-side route change** —
   new file `apps/web/src/app/ScrollToTop.tsx`, mounted in `Root.tsx`. React
   Router's `<Outlet>` swap never resets `window.scrollY`; a screen the user
   scrolled down on (e.g. Recall, after several point fields) left the
   *next* screen also scrolled down, pushing its header and the demo banner
   off-screen. Confirmed via `e2e/a11y/axe-session.spec.ts`'s own "demo
   banner in viewport" case.

8. **Two accessibility violations on Progress's data tables/export
   preview** — `AttemptTable.tsx`, `ExactValuesTable.tsx`, `ExportPreview.tsx`
   (missing `tabIndex={0}` on horizontally-scrollable containers — axe's
   `scrollable-region-focusable`, WCAG 2.1.1) and `DailyTrend.tsx`/
   `PracticeTrend.tsx` (Recharts' root `<svg>` defaults to `tabindex="0"`
   inside an `aria-hidden="true"` chart wrapper — axe's `aria-hidden-focus`,
   WCAG 4.1.2; fixed with `tabIndex={-1}` on the chart component).

## Real bugs found and fixed (test-design bugs)

These were wrong assumptions or races in the *new* Group 9 spec files
themselves, not app defects — listed for context since several look
superficially similar to the app bugs above.

- **`getByRole('status', {name})` finds nothing** — `role="status"` is a
  live-region role whose accessible *name* comes from `aria-label`/
  `aria-labelledby`, never automatically from text content the way an
  interactive role does. Fixed 9 occurrences across 4 files (written by
  different parallel agents, same mistake each time) to `getByText(...,
  {exact: true})`.
- **Reload-latency assumptions in `refresh.spec.ts`/`never-completed.spec.ts`**
  — `demo.setClock` is an *offset* added to real wall-clock time, not a
  frozen instant, so real time a `page.reload()` or a UI confirm-dialog
  round trip itself consumes lands on top of whatever `advance()` last set.
  Several `±1s`/`±2s` tolerances around a static expected value were
  unrealistically tight; loosened (asymmetrically — only the direction real
  latency can actually push the value) with a documented rationale.
- **`syncStatus.toContainText('Saved')` used as a synchronization gate** in
  `refresh.spec.ts` — the outbox reads "Saved" from mount too (nothing
  recorded yet), so the assertion could pass on stale prior text without
  ever confirming a click's own flush actually landed. Replaced with an
  `expect.poll` against server truth.
- **A Playwright click racing its own target's removal** —
  `recovery.spec.ts`'s "Retry" button: the local demo server acknowledges a
  retry batch faster than Playwright's own multi-frame stability check can
  confirm the click, so `.click()` chased a target that kept detaching.
  Fixed with `.dispatchEvent('click')`.
- **`idempotency.spec.ts` assumed exactly 2 finalize network calls** — a
  legitimate, unrelated `PracticeReview` mount-time flush can race the
  test's own `page.unroute()`, occasionally reaching the server first and
  making a 3rd finalize call from `useFinalizeSession.ts`'s own outer retry
  loop both correct *and* expected. Relaxed to "≥2 calls, all identical
  keys" — the actual invariant the task brief describes.
- **`installLiveRegionObserver`'s `MutationObserver` missed brand-new live
  regions** — `timer-live-region.spec.ts`: it only checked whether a
  mutation's *target* (the parent) sat inside a `role=status`-matching
  ancestor, never whether one of the *added nodes* itself was the new live
  region (Recall's "Time is up" paragraph is conditionally rendered, not
  pre-existing). Fixed to also check `record.addedNodes`; also corrected
  the expected text to the app's real copy ("Time is up — save when you are
  ready", not "Time is up").
- **`document.getAnimations()` caught a correctly-neutralized 0.01ms CSS
  transition mid-flight** — `reduced-motion.spec.ts`: a reduced-motion
  transition still briefly reports `playState: 'running'` right after it
  starts, and a route change's own re-render cascade can start a second one
  after the first's `finished` promise already resolved. Fixed with a
  bounded (iteration-count, not wall-clock — works whether or not the fake
  clock is installed) settle loop.
- **A genuine, narrow Playwright/Radix interop race in `keyboard-review.spec.ts`**
  — pressing `ArrowRight` in a Radix `RadioGroup` sometimes never
  synthesizes its own selection click at all (not merely late — reproduced
  with a 15s fake-clock-nudging poll that still never saw `data-state`
  become `"checked"`). This is specific to Playwright's synthetic key
  dispatch, not a real user-facing issue. Fixed with a bounded fast-path
  poll, falling back to a `Space` keypress (a second, independent, native
  selection path) only if the fast path times out. Validated 12/12 clean
  runs after the fix.

## Investigation discipline this session followed (repeat it)

For every failure: read the actual error, form a hypothesis about root
cause, verify it against the real source (app code *and* test code) before
fixing either side. Several bugs above were only found because a failure
that looked like "just flaky timing" turned out, on inspection, to be a
real defect — and conversely, several fixes belong entirely in the test
file because the app's behavior was already correct. Do not fix by guessing;
do not skip a failure as "probably flaky" without at least one investigation
pass.

## Files changed, uncommitted

Run `git status` / `git diff --stat` for the authoritative list. As of this
writing:

- **Real app fixes** (see bug list above): `apps/api/src/services/review.ts`,
  `apps/web/src/app/Root.tsx`, `apps/web/src/app/ScrollToTop.tsx` (new),
  `apps/web/src/features/focus/{TransitionControls,useClockGap,
  useOutboxStatus,useSessionEvents}.tsx`, `apps/web/src/features/progress/
  {AttemptTable,DailyTrend,ExactValuesTable,ExportPreview,PracticeTrend}.tsx`,
  `apps/web/src/features/settings/{ResetPanel,ScenarioLoader}.tsx`,
  `apps/web/src/features/today/BlockCard.tsx`,
  `apps/web/src/lib/clock/remaining.ts`, `apps/web/src/lib/query/
  sessionMode.tsx`, `apps/web/src/ui/Button.tsx`,
  `packages/shared/src/contracts/sessions.ts`.
- **New e2e spec files** (20 files — the actual Group 9 deliverable):
  `e2e/acceptance/{baseline-day,comparison-guards,comparison-outcomes,
  harness,new-user,recovery,timing-deviation,working-day}.spec.ts`,
  `e2e/invariants/{day8-revision,hidden-tab,idempotency,never-completed,
  progression,refresh,two-tabs}.spec.ts`, `e2e/a11y/{axe-session,axe-shell,
  keyboard-review,reduced-motion,timer-live-region}.spec.ts`.
- **New/modified e2e support files**: `e2e/support/benchmark.ts` (new,
  shared `runBenchmark()` helper), `e2e/support/helpers.spec.ts` (new),
  `e2e/support/{clock,demo}.ts` (extended — see task 9.1.1/9.1.4 in
  `tasks.md` for exactly what), `e2e/playwright.config.ts` (new
  `acceptance` project, port 8788, D37's build-and-serve topology).
- `openspec/changes/build-initial-mvp/tasks.md` — Group 9's 21 checkboxes
  marked `[x]`.
- `.agents/`, `.claude/` — pre-existing, unrelated tooling directories, not
  part of this change (excluded from the Groups 1-8 commit too; do the same
  here).

## Key technical context for continuing (Group 10 and beyond)

- **D37**: the `acceptance` Playwright project serves the app from one
  origin (`http://127.0.0.1:8788`) via a real build + the API's own static
  file serving — `webServer` runs `npm run build -w @attention-lab/web`
  fresh on every invocation, so a source fix is always picked up without a
  manual rebuild step.
- **`workers: 1`/`fullyParallel: false`** for the `acceptance` project:
  every spec shares one demo principal. Never run acceptance specs in
  parallel against each other.
- **D9** (events are append-only): a "resolution" or "correction" to prior
  state is always a *new* event, never an edit of an old one — this was the
  root of bug #3 above and is worth remembering for any future event-model
  work.
- **`Obj()`** (`packages/shared/src/contracts/common.ts`) always sets
  `additionalProperties: false` — any new field a client or server needs to
  send must be added to the schema explicitly, or it 400s silently (bug #4).
- Group 10's 8 tasks are **documentation-only** per their own `tasks.md`
  entries: README.md, CLAUDE.md, the PRD/PoC/protocol decision logs, a
  `LIMITATIONS.md`, and two verification scripts
  (`check-limitations.mjs`/`check-claude-md.mjs`/`verify-all.mjs`). No
  application code changes are expected there — if one seems necessary,
  treat that as a signal to pause and check the task brief again rather
  than silently expanding scope.

---
*Written by an autonomous Claude Code session during `/opsx:apply
build-initial-mvp`, after finishing Group 9's live verification and its full
regression pass (both complete and clean — see above). Safe to delete once
Group 9 is committed, since its content will then be fully superseded by the
commit message and `tasks.md`.*
