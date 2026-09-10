# shadcn/ui Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/web`'s hand-rolled Tailwind styling with a shadcn/ui primitive layer and the "Instrument log" token system, reworking each screen's layout, without changing a single route, query, request body, accessible name, ARIA attribute or `data-testid`.

**Architecture:** Three waves. Wave 0 is a single-owner foundation that installs shadcn, replaces the token system in `index.css` (merging, never overwriting, the documented accessibility baseline), and builds four shared primitives every screen consumes. Wave 1 converts twelve directories in parallel, one owner each, against a frozen primitive API. Wave 2 verifies sequentially. Wave 1 cannot begin until Wave 0 is green.

**Tech Stack:** React 19.2.8, Vite 8.2.2, Tailwind CSS 4.3.3 (CSS-first, no config file), `radix-ui` 1.6.7 (unified package), TanStack Query 5.102.8, React Router 8.3.1, Recharts 3.10.1, Vitest 5.0.0, Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Exact version pins (D3).** Every new dependency is pinned to an exact version — no `^`, no `~` — and added to the "Version pins (D3)" table in `LIMITATIONS.md`. That table is machine-checked by `scripts/check-pins.mjs` against `package-lock.json`; the script strips Markdown emphasis from a cell before comparing.
- **Unknown is never zero.** A blank input is never written or displayed as `0`. Never introduce `?? 0`, `|| 0`, or `COALESCE(...,0)` on a nullable count.
- **No red for measurement outcomes.** `--destructive` is scoped strictly to destructive *actions*: "Reset demo data", "Abandon session", "Delete". Never for a result, a lapse, an overrun, a missed day, or a high feed number.
- **No invented score.** No composite figure, no percentage claim beyond the server's own, no confidence interval, no significance language.
- **Mono type in exactly three contexts:** timer digits, the exact-values tables, tabular figures in comparisons. Never for labels, status words, metadata, or prose containing a number.
- **No all-caps eyebrow labels, no middle-dot meta strings, no arrow appended to button or link text, no single-word accenting in a headline.**
- **One expressive motion beat:** a value crossing pending → recorded. Skeletons do not pulse. Nothing celebratory at `0:00`.
- **One `data-variant="primary"` per interactive surface.** A modal is its own surface.
- **The global `:focus-visible` rule in `index.css` is the only focus indicator.** Strip `focus-visible:*` classes from every generated shadcn component. No component-level focus affordance, including hover-and-focus underlines.
- **Node 22.9+**, npm workspaces, all commands run from the repo root.

### The preserved contract — never change these

Full detail in the spec §1 and §6. The load-bearing items:

| Item | Why |
|---|---|
| Every `data-testid` in `apps/web/src` | asserted by unit and Playwright suites |
| `data-variant` on `Button`, values `primary`/`secondary`/`quiet` | `toHaveAttribute` assertions; `ButtonVariant` union stays closed |
| `data-block-index="{N}"` | read by **application code** — `Today.tsx`'s `focusBlockStartForm` does `document.querySelector` then focuses the first control inside |
| `data-placement="rail"\|"bottom"` | queried by `RailLayout.test.tsx` |
| `data-mode="benchmark"` | queried by `Ready.test.tsx` |
| `scope="col"` on every `<th>` | `AttemptTable`, `ExactValuesTable` |
| `tabIndex={0}` on horizontally scrolling wrappers | deliberate axe-driven choice |
| `tabIndex={-1}` on Recharts roots | defeats Recharts' own `tabindex="0"` inside `aria-hidden` wrappers |
| `aria-busy="true"` on every loading branch | asserted throughout |
| `aria-hidden="true"` on chart wrappers, paired with a real table | the table is the accessible equivalent |
| The single `aria-live="polite"` region in `ui/LiveRegion.tsx` | ticking timer digits are deliberately outside it; `TimerDisplay.test.tsx` asserts `digits.closest('[aria-live]')` is `null` |
| All section `aria-label`s, fieldset legends, dialog titles, accessible names | queried by role+name throughout |
| `TransitionControls`' `focusOnMount` callback ref | Radix `AlertDialog.Content` does not auto-focus its first tabbable child here; confirmed empirically via `e2e/a11y/keyboard-review.spec.ts`. A `useEffect` does not work — Content portals its children, so the node does not exist on the render that opens the dialog. |

### Correction to the spec

Spec §5 says `format.ts` and `trendFormat.ts` gain the `absenceTier` predicate. Those files live under `features/progress/`, but the taxonomy is needed by `checkin`, `benchmark`, `review` and `today` as well. `absenceTier` therefore lives in `src/ui/reported.ts` (Task 6). The formatter files are unchanged and keep returning their exact current strings.

---

## File Structure

**Created in Wave 0:**

| File | Responsibility |
|---|---|
| `apps/web/components.json` | shadcn CLI configuration |
| `apps/web/src/lib/cn.ts` | the `cn()` class-merge helper |
| `apps/web/src/ui/shadcn/*.tsx` | generated primitives, focus rings stripped |
| `apps/web/src/ui/field.ts` | `useField` — id generation and ARIA wiring for form controls |
| `apps/web/src/ui/reported.ts` | `ValueTier`, `absenceTier` |
| `apps/web/src/ui/Reported.tsx` | the `<Reported>` component that applies a tier |
| `apps/web/src/ui/Reported.test.tsx` | taxonomy tests, including the `20+, capped` case |
| `apps/web/src/ui/field.test.tsx` | ARIA wiring tests |

**Modified in Wave 0:** `apps/web/src/index.css` (tokens replaced, accessibility baseline preserved), `apps/web/src/ui/Button.tsx` (+`asChild`), `apps/web/package.json`, `package-lock.json`, `LIMITATIONS.md`.

Generated primitives go in `src/ui/shadcn/` rather than shadcn's default `src/components/ui/`, because `src/ui/` is already this app's primitive home and `src/components/` does not exist. The subdirectory keeps generated files visibly separate from hand-written ones.

**Wave 1 units — twelve, disjoint, one owner each:**

`src/app/` (first), then `features/today`, `features/setup`, `features/benchmark`, `features/review`, `features/focus`, `features/checkin`, `features/progress`, `features/research`, `features/settings`, `features/session`, and `src/ui/` non-generated leftovers.

---

# Wave 0 — Foundation (sequential, single owner)

Nothing in Wave 1 starts until every task here is committed and `npm run typecheck && npm run test` is green.

---

### Task 1: Install shadcn and its dependencies, pinned

**Files:**
- Create: `apps/web/components.json`, `apps/web/src/lib/cn.ts`
- Modify: `apps/web/package.json`, `package-lock.json`, `LIMITATIONS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/cn.js`.

- [ ] **Step 1: Install the four runtime dependencies at exact versions**

```bash
npm install -w @attention-lab/web --save-exact \
  class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 2: Record the resolved versions**

```bash
node -e "const p=require('./apps/web/package.json');for(const k of ['class-variance-authority','clsx','tailwind-merge','lucide-react'])console.log(k,p.dependencies[k])"
```

Expected: four lines, each an exact version with no `^` or `~` prefix. If any carries a range prefix, edit `apps/web/package.json` to the bare version and re-run `npm install`.

- [ ] **Step 3: Write `components.json`**

Tailwind v4 has no config file, so `tailwind.config` is the empty string. `ui` points at the subdirectory chosen above.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/ui",
    "utils": "@/lib/cn",
    "ui": "@/ui/shadcn",
    "lib": "@/lib",
    "hooks": "@/lib"
  }
}
```

- [ ] **Step 4: Write `cn()` by hand**

Do not run `shadcn init` — it rewrites `src/index.css`, which holds the documented accessibility baseline. Writing these two files by hand is the whole of what init would have contributed that we want.

```ts
// apps/web/src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Class merge used by every generated shadcn primitive. `twMerge` resolves
 * Tailwind conflicts last-wins, so a caller's `className` always beats the
 * component's own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Verify the alias resolves**

```bash
npm run typecheck -w @attention-lab/web
```

Expected: PASS. If `@/lib/cn.js` fails to resolve, confirm `apps/web/tsconfig.json` still has `"paths": { "@/*": ["./src/*"] }` and `vite.config.ts` still has the matching `resolve.alias`.

- [ ] **Step 6: Add the four pins to `LIMITATIONS.md`**

Append these rows to the "Version pins (D3)" table, substituting the versions printed in Step 2:

```markdown
| class-variance-authority | <registry version> | <pinned> | none |
| clsx | <registry version> | <pinned> | none |
| tailwind-merge | <registry version> | <pinned> | none |
| lucide-react | <registry version> | <pinned> | none |
```

- [ ] **Step 7: Verify the pin checker passes**

Run: `node scripts/check-pins.mjs`
Expected: `PINS OK`

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/components.json apps/web/src/lib/cn.ts package-lock.json LIMITATIONS.md
git commit -m "Add shadcn/ui dependencies and the cn() helper, pinned exactly"
```

---

### Task 2: Replace the token system in index.css

**Files:**
- Modify: `apps/web/src/index.css`
- Test: `apps/web/src/index.css.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-paper`, `--color-card`, `--color-rule`, `--color-ink`, `--color-ink-muted`, `--color-signal`, `--color-attention`, `--color-destructive`, `--color-focus-ring`, `--radius`; plus shadcn's alias names `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--border`, `--input`, `--ring`, `--muted`, `--muted-foreground`, `--card`, `--card-foreground`, `--destructive`.

The old names (`--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`, `--color-primary-text`) are **removed**. Wave 1 agents will find and replace their call sites; a leftover reference renders as an invalid colour, not a silent wrong colour, which is the failure mode we want.

- [ ] **Step 1: Write the failing test**

`reducedMotion.test.ts` already asserts `index.css` contains `:focus-visible {` and a `prefers-reduced-motion` block. This new test guards the token contract and the two things most likely to be lost in a rewrite.

```ts
// apps/web/src/index.css.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('index.css token contract', () => {
  it('declares every Instrument-log token', () => {
    for (const token of [
      '--color-paper: #F3F5F5',
      '--color-card: #FFFFFF',
      '--color-rule: #D5DBDA',
      '--color-ink: #16232B',
      '--color-ink-muted: #455761',
      '--color-signal: #0B5F63',
      '--color-attention: #8A5A00',
    ]) {
      expect(css).toContain(token)
    }
  })

  it('keeps the single global focus-visible rule', () => {
    expect(css).toContain(':focus-visible {')
    expect(css).toContain('outline: 2px solid var(--color-focus-ring)')
  })

  it('keeps the reduced-motion block', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('no longer declares the superseded token names', () => {
    for (const dead of ['--color-bg:', '--color-surface:', '--color-text:', '--color-primary:']) {
      expect(css).not.toContain(dead)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- index.css`
Expected: FAIL — the Instrument-log tokens do not exist yet and the superseded names still do.

- [ ] **Step 3: Rewrite the `:root` block**

Replace the existing `:root` declarations inside `@layer base`. **Keep the `body` rule, the `:focus-visible` rule and the `prefers-reduced-motion` block exactly as they are**, other than repointing `body`'s two custom properties. Keep the comment discipline — every contrast figure is a computed WCAG relative-luminance value for the exact hex pair, not an estimate.

```css
@layer base {
  :root {
    /* ---- Instrument log tokens. Contrast figures are computed for the exact
     * hex pairs below, against --color-paper unless stated otherwise. ---- */

    /* Ground and surface. */
    --color-paper: #F3F5F5;   /* page ground, cool-neutral off-white */
    --color-card: #FFFFFF;    /* raised surfaces only */
    --color-rule: #D5DBDA;    /* hairlines and field slots — never text */

    /* Text, and recorded data. */
    --color-ink: #16232B;       /* ~14.7:1 */
    --color-ink-muted: #455761; /* ~6.9:1 */

    /* State. */
    --color-signal: #0B5F63;    /* white on this fill is ~7.4:1 */
    --color-signal-text: #FFFFFF;
    --color-attention: #8A5A00; /* ~5.4:1 as text, white on it ~5.9:1 */

    /* Destructive ACTIONS only — never a measurement outcome. */
    --color-destructive: #8C2F1B;
    --color-destructive-text: #FFFFFF;

    /*
     * Focus ring. `outline-offset: 2px` paints the ring entirely outside a
     * control's border box, so it never renders on that control's own fill —
     * only on whatever surrounds it. Against both surfaces this palette uses
     * for that, pure black is far clear of any threshold: ~19.2:1 on
     * --color-paper and 21:1 on --color-card.
     *
     * Recorded limitation: black does NOT clear 3:1 against two of this
     * palette's fills — ~2.8:1 on --color-signal and ~2.5:1 on
     * --color-destructive. That only bites if a focusable control is ever
     * nested inside a signal- or destructive-filled surface, which no screen
     * in this app does today. If one is ever introduced, that surface needs
     * its own ring colour; do not assume this token covers it.
     */
    --color-focus-ring: #000000;

    --radius: 0.375rem;

    /* ---- shadcn alias names. The generated primitives are written against
     * these; they are aliases, not a second palette. ---- */
    --background: var(--color-paper);
    --foreground: var(--color-ink);
    --card: var(--color-card);
    --card-foreground: var(--color-ink);
    --popover: var(--color-card);
    --popover-foreground: var(--color-ink);
    --primary: var(--color-signal);
    --primary-foreground: var(--color-signal-text);
    --secondary: var(--color-card);
    --secondary-foreground: var(--color-ink);
    --muted: var(--color-card);
    --muted-foreground: var(--color-ink-muted);
    --accent: var(--color-card);
    --accent-foreground: var(--color-ink);
    --destructive: var(--color-destructive);
    --destructive-foreground: var(--color-destructive-text);
    --border: var(--color-rule);
    --input: var(--color-rule);
    --ring: var(--color-focus-ring);

    color-scheme: light;
  }

  body {
    background-color: var(--color-paper);
    color: var(--color-ink);
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  }
```

- [ ] **Step 4: Expose the tokens to Tailwind v4**

Tailwind v4 reads `@theme`, not a config file. Add this block immediately after `@import "tailwindcss";` so utilities like `bg-paper` and `text-ink` exist.

```css
@theme {
  --color-paper: #F3F5F5;
  --color-card: #FFFFFF;
  --color-rule: #D5DBDA;
  --color-ink: #16232B;
  --color-ink-muted: #455761;
  --color-signal: #0B5F63;
  --color-attention: #8A5A00;
  --color-destructive: #8C2F1B;
  --radius-DEFAULT: 0.375rem;
  --font-sans: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

Note: `@theme` values must be literal, not `var(...)` references — Tailwind v4 resolves them at parse time. The duplication between `@theme` and `:root` is deliberate and unavoidable.

- [ ] **Step 5: Run the tests**

Run: `npm run test -w @attention-lab/web -- index.css reducedMotion`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/index.css apps/web/src/index.css.test.ts
git commit -m "Replace the web token system with the Instrument-log palette"
```

---

### Task 3: Self-host IBM Plex

**Files:**
- Modify: `apps/web/package.json`, `apps/web/src/main.tsx`, `LIMITATIONS.md`

**Interfaces:**
- Consumes: the `--font-sans` / `--font-mono` theme entries from Task 2.
- Produces: the two families actually loaded at runtime.

- [ ] **Step 1: Install, pinned**

```bash
npm install -w @attention-lab/web --save-exact @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
```

- [ ] **Step 2: Import the weights actually used, and no others**

The scale uses regular and semibold for sans, regular for mono. Importing the full family would add several hundred kilobytes for nothing.

```ts
// apps/web/src/main.tsx — add above the existing './index.css' import
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
```

- [ ] **Step 3: Verify the build succeeds and note the cost**

```bash
npm run build -w @attention-lab/web
```

Expected: PASS. Record the reported bundle size delta in the commit message — the spec's §12 flags font weight as unmeasured, and this is where it gets measured.

- [ ] **Step 4: Add both pins to `LIMITATIONS.md`**, same table and format as Task 1 Step 6.

- [ ] **Step 5: Verify the pin checker**

Run: `node scripts/check-pins.mjs`
Expected: `PINS OK`

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/main.tsx package-lock.json LIMITATIONS.md
git commit -m "Self-host IBM Plex Sans and Mono at the three weights used"
```

---

### Task 4: Generate the primitives, focus rings stripped and skeleton static

**Files:**
- Create: `apps/web/src/ui/shadcn/*.tsx` (eighteen components)
- Test: `apps/web/src/ui/shadcn/conventions.test.ts` (create)

**Interfaces:**
- Consumes: `cn()` from Task 1, tokens from Task 2.
- Produces: the eighteen primitives, importable as `@/ui/shadcn/<name>.js`.

- [ ] **Step 1: Write the failing convention test**

This is the guard that makes "strip the focus rings" and "skeletons do not pulse" enforceable rather than aspirational, across all eighteen files and any future regeneration.

```ts
// apps/web/src/ui/shadcn/conventions.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

describe('generated shadcn primitives', () => {
  it('generated at least the eighteen primitives the design calls for', () => {
    expect(files.length).toBeGreaterThanOrEqual(18)
  })

  it.each(files)('%s declares no focus-visible styling of its own', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    expect(source).not.toMatch(/focus-visible:/)
  })

  it.each(files)('%s declares no animation utility', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    expect(source).not.toMatch(/animate-pulse|animate-spin|animate-bounce/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- conventions`
Expected: FAIL — the directory does not exist yet.

- [ ] **Step 3: Generate the eighteen primitives**

```bash
cd apps/web && npx shadcn@latest add --yes --overwrite \
  button card input label textarea checkbox radio-group select switch \
  collapsible dialog alert-dialog alert badge separator table skeleton tooltip
```

If the CLI reports it cannot find configuration, confirm `components.json` from Task 1 is present in `apps/web/`.

- [ ] **Step 4: Strip every `focus-visible:` utility**

Each generated component carries a cluster like `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`. Remove those utilities and leave the rest of each class string untouched. Do not replace them with anything — the global rule in `index.css` already covers every interactive element.

```bash
cd apps/web/src/ui/shadcn
sed -i -E 's/focus-visible:[a-zA-Z0-9:\/\[\]._-]+ ?//g' *.tsx
```

- [ ] **Step 5: Make the skeleton static**

Open `skeleton.tsx` and replace the `animate-pulse` utility with the ruled-slot treatment. A loading placeholder is an unfilled slot, which is the same mark the absent tier uses — see Task 6.

```tsx
// apps/web/src/ui/shadcn/skeleton.tsx
import { cn } from '@/lib/cn.js'

/**
 * A loading placeholder renders as a static unfilled ruled slot, never a
 * pulse. The app permits exactly one expressive animation — a value crossing
 * from pending to recorded — and a shimmering skeleton would be a second one.
 * The slot reads as "no value here yet", which is what loading means.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('rounded-sm border-b border-dashed border-[var(--color-rule)] bg-transparent', className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 6: Run the convention test**

Run: `npm run test -w @attention-lab/web -- conventions`
Expected: PASS on all three assertions for all eighteen files.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @attention-lab/web`
Expected: PASS. If a generated component imports from `@/components/ui/...`, correct the import to `@/ui/shadcn/...` — the CLI occasionally writes its default path into cross-component imports.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/shadcn
git commit -m "Generate the shadcn primitives with focus rings stripped and a static skeleton"
```

---

### Task 5: Extend Button with asChild, keeping data-variant

**Files:**
- Modify: `apps/web/src/ui/Button.tsx`
- Test: `apps/web/src/ui/Button.test.tsx:1-40`

**Interfaces:**
- Consumes: `cn()` (Task 1), `Slot` from `radix-ui`.
- Produces:

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'quiet'
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  asChild?: boolean
  ref?: Ref<HTMLButtonElement>
}
export function Button(props: ButtonProps): ReactElement
```

`ButtonVariant` stays a closed three-value union. There is no `destructive` variant — destructive confirmations pass `variant="secondary"` with a destructive `className`.

- [ ] **Step 1: Write the failing tests**

Append to the existing `Button.test.tsx`. The nested-interactive assertion is the one that matters: a naive `asChild` renders `<button><a/></button>`, which is invalid and would silently break `getByRole('link', { name: 'Go to Today' })` in `NotFound`.

```tsx
it('asChild renders the child element and does not nest a button around it', () => {
  render(
    <Button asChild variant="primary">
      <a href="/today">Go to Today</a>
    </Button>,
  )

  const link = screen.getByRole('link', { name: 'Go to Today' })
  expect(link.tagName).toBe('A')
  expect(link).toHaveAttribute('data-variant', 'primary')
  expect(link.querySelector('button')).toBeNull()
  expect(link.closest('button')).toBeNull()
})

it('asChild does not force type=button onto a non-button child', () => {
  render(
    <Button asChild>
      <a href="/today">Go to Today</a>
    </Button>,
  )
  expect(screen.getByRole('link', { name: 'Go to Today' })).not.toHaveAttribute('type')
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test -w @attention-lab/web -- Button`
Expected: FAIL — `asChild` is not a recognised prop, so React warns and the assertions fail.

- [ ] **Step 3: Implement**

The `type` handling is the subtle part: `type="button"` is a deliberate safety default so a stray Button never submits its enclosing form, but it is meaningless and invalid on an anchor, so it is applied only when actually rendering a `<button>`.

```tsx
import type { ButtonHTMLAttributes, ReactElement, Ref } from 'react'
import { Slot } from 'radix-ui'

import { cn } from '../lib/cn.js'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /**
   * Render the single child element instead of a <button>, forwarding every
   * class and prop onto it. Used for links that look like buttons, which
   * previously duplicated a LINK_CLASSES constant across four features.
   * Renders the child itself — never a <button> wrapping an <a>, which would
   * be invalid nested-interactive markup and would change the element's role.
   */
  asChild?: boolean
  ref?: Ref<HTMLButtonElement>
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-signal text-white hover:brightness-95 active:brightness-90',
  secondary: 'bg-card text-ink border border-rule hover:bg-paper',
  quiet: 'bg-transparent text-ink hover:bg-card',
}

export function Button({ variant = 'primary', type, asChild = false, className, ref, ...buttonProps }: ButtonProps): ReactElement {
  const Component = asChild ? Slot.Root : 'button'
  const classes = cn(
    'inline-flex items-center justify-center gap-2',
    'min-h-11 min-w-11 rounded-md px-4',
    'text-sm font-medium',
    'transition-colors',
    'disabled:opacity-50 disabled:pointer-events-none',
    VARIANT_CLASS[variant],
    className,
  )

  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { type: type ?? 'button' })}
      data-variant={variant}
      className={classes}
      {...buttonProps}
    />
  )
}
```

- [ ] **Step 4: Run the full Button suite**

Run: `npm run test -w @attention-lab/web -- Button`
Expected: PASS — the one pre-existing test (`Button primary renders type=button with data-variant=primary and its accessible name`) plus the two new ones. The file already imports `render`, `screen`, `describe`, `expect` and `it`, so the new cases need no added imports.

- [ ] **Step 5: Verify no consumer broke**

Run: `npm run test -w @attention-lab/web`
Expected: PASS. `Button` has roughly a hundred call sites and this task changed its internals; a failure here means the class output moved, not that `asChild` is wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Button.tsx apps/web/src/ui/Button.test.tsx
git commit -m "Add asChild to Button via Radix Slot, keeping data-variant and the closed variant union"
```

---

### Task 6: The value taxonomy — absenceTier and Reported

**Files:**
- Create: `apps/web/src/ui/reported.ts`, `apps/web/src/ui/Reported.tsx`, `apps/web/src/ui/Reported.test.tsx`

**Interfaces:**
- Consumes: `cn()` (Task 1).
- Produces:

```ts
export type ValueTier = 'recorded' | 'absent' | 'uncertain'
export function absenceTier(text: string): ValueTier
export interface ReportedProps {
  readonly children: string
  readonly mono?: boolean
  readonly className?: string
}
export function Reported(props: ReportedProps): ReactElement
```

`<Reported>` emits `data-tier` carrying the resolved tier. That attribute is new and additive; no existing test reads it, and Wave 1 tests may assert on it.

- [ ] **Step 1: Write the failing tests**

The third case is the one this whole component exists for.

```tsx
// apps/web/src/ui/Reported.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { absenceTier } from './reported.js'
import { Reported } from './Reported.js'

describe('absenceTier', () => {
  it('treats every not-a-value string as absent', () => {
    for (const text of ['Not reported', 'not yet reported', 'Not finalized', '—', 'Percentage: not applicable']) {
      expect(absenceTier(text)).toBe('absent')
    }
  })

  it('treats the two uncertainty strings as uncertain', () => {
    expect(absenceTier('Unknown')).toBe('uncertain')
    expect(absenceTier('Timing uncertain')).toBe('uncertain')
  })

  it('treats "20+, capped" as a recorded measurement, not an absence', () => {
    expect(absenceTier('20+, capped')).toBe('recorded')
  })

  it('treats an explicit zero as recorded', () => {
    expect(absenceTier('0')).toBe('recorded')
    expect(absenceTier('0 min')).toBe('recorded')
  })
})

describe('Reported', () => {
  it('marks an absent value without rendering it as zero or empty', () => {
    render(<Reported>Not reported</Reported>)
    const el = screen.getByText('Not reported')
    expect(el).toHaveAttribute('data-tier', 'absent')
  })

  it('marks 20+, capped as recorded so it is never styled as a gap', () => {
    render(<Reported>20+, capped</Reported>)
    expect(screen.getByText('20+, capped')).toHaveAttribute('data-tier', 'recorded')
  })

  it('marks Unknown as uncertain, distinctly from an absent value', () => {
    render(<Reported>Unknown</Reported>)
    expect(screen.getByText('Unknown')).toHaveAttribute('data-tier', 'uncertain')
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test -w @attention-lab/web -- Reported`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the predicate**

Matching is against an explicit closed set, never a substring or a heuristic. `20+, capped` and any numeric string fall through to `recorded` by design.

```ts
// apps/web/src/ui/reported.ts

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
```

- [ ] **Step 4: Implement the component**

```tsx
// apps/web/src/ui/Reported.tsx
import type { ReactElement } from 'react'

import { cn } from '../lib/cn.js'
import { absenceTier, type ValueTier } from './reported.js'

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
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -w @attention-lab/web -- Reported`
Expected: PASS, all seven cases.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/reported.ts apps/web/src/ui/Reported.tsx apps/web/src/ui/Reported.test.tsx
git commit -m "Add the three-tier value taxonomy, keeping 20+, capped as a recorded measurement"
```

---

### Task 7: The useField ARIA wiring hook

**Files:**
- Create: `apps/web/src/ui/field.ts`, `apps/web/src/ui/field.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface FieldWiring {
  readonly inputId: string
  readonly labelProps: { readonly htmlFor: string }
  readonly controlProps: {
    readonly id: string
    readonly 'aria-describedby': string | undefined
    readonly 'aria-invalid': true | undefined
    readonly 'aria-required': true | undefined
  }
  readonly descriptionProps: { readonly id: string } | undefined
  readonly errorProps: { readonly id: string; readonly role: 'alert' } | undefined
}

export interface UseFieldOptions {
  readonly name: string
  readonly description?: string | undefined
  readonly error?: string | null | undefined
  readonly required?: boolean | undefined
}

export function useField(options: UseFieldOptions): FieldWiring
```

A hook rather than a wrapper component, because every form in this app is controlled with manual submit handling and its markup shape is asserted by tests. A hook wires ARIA without moving any element.

This fixes spec §9 defect 2 — the recall points, disruption note, review note, replacement reason and output note all render a character counter that no `aria-describedby` points at.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/ui/field.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useField } from './field.js'

function Probe({ description, error, required }: { description?: string; error?: string | null; required?: boolean }) {
  const field = useField({ name: 'note', description, error, required })
  return (
    <>
      <label {...field.labelProps}>Note</label>
      <textarea {...field.controlProps} />
      {field.descriptionProps ? <p {...field.descriptionProps}>{description}</p> : null}
      {field.errorProps ? <p {...field.errorProps}>{error}</p> : null}
    </>
  )
}

describe('useField', () => {
  it('associates the label with the control', () => {
    render(<Probe />)
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
  })

  it('points aria-describedby at the description when there is one', () => {
    render(<Probe description="500 characters left" />)
    const control = screen.getByLabelText('Note')
    const describedBy = control.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent('500 characters left')
  })

  it('omits aria-describedby entirely when there is neither description nor error', () => {
    render(<Probe />)
    expect(screen.getByLabelText('Note')).not.toHaveAttribute('aria-describedby')
  })

  it('describes by both description and error at once, description first', () => {
    render(<Probe description="500 characters left" error="Required" />)
    const ids = (screen.getByLabelText('Note').getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[0] as string)).toHaveTextContent('500 characters left')
    expect(document.getElementById(ids[1] as string)).toHaveTextContent('Required')
  })

  it('marks the control invalid only when there is an error', () => {
    const { rerender } = render(<Probe />)
    expect(screen.getByLabelText('Note')).not.toHaveAttribute('aria-invalid')
    rerender(<Probe error="Required" />)
    expect(screen.getByLabelText('Note')).toHaveAttribute('aria-invalid', 'true')
  })

  it('gives the error row role=alert so it is announced', () => {
    render(<Probe error="Required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test -w @attention-lab/web -- field`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/ui/field.ts
import { useId } from 'react'

export interface FieldWiring {
  readonly inputId: string
  readonly labelProps: { readonly htmlFor: string }
  readonly controlProps: {
    readonly id: string
    readonly 'aria-describedby': string | undefined
    readonly 'aria-invalid': true | undefined
    readonly 'aria-required': true | undefined
  }
  readonly descriptionProps: { readonly id: string } | undefined
  readonly errorProps: { readonly id: string; readonly role: 'alert' } | undefined
}

export interface UseFieldOptions {
  readonly name: string
  readonly description?: string | undefined
  readonly error?: string | null | undefined
  readonly required?: boolean | undefined
}

/**
 * Generates ids and the ARIA wiring for one form control, without imposing a
 * markup shape — every form in this app is controlled with manual submit
 * handling, and its structure is asserted by tests.
 *
 * `aria-describedby` lists the description before the error, so a screen
 * reader hears the constraint before the complaint. It is omitted entirely
 * rather than set to an empty string when there is neither.
 */
export function useField({ name, description, error, required }: UseFieldOptions): FieldWiring {
  const scope = useId()
  const inputId = `${scope}-${name}`
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`

  const hasDescription = description !== undefined && description !== ''
  const hasError = error !== undefined && error !== null && error !== ''

  const describedBy = [hasDescription ? descriptionId : undefined, hasError ? errorId : undefined]
    .filter((id): id is string => id !== undefined)
    .join(' ')

  return {
    inputId,
    labelProps: { htmlFor: inputId },
    controlProps: {
      id: inputId,
      'aria-describedby': describedBy === '' ? undefined : describedBy,
      'aria-invalid': hasError ? true : undefined,
      'aria-required': required === true ? true : undefined,
    },
    descriptionProps: hasDescription ? { id: descriptionId } : undefined,
    errorProps: hasError ? { id: errorId, role: 'alert' } : undefined,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- field`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/field.ts apps/web/src/ui/field.test.tsx
git commit -m "Add useField, wiring aria-describedby and aria-invalid without moving markup"
```

---

### Task 8: Wave 0 gate

**Files:** none — this is a checkpoint, not a change.

**Interfaces:**
- Consumes: every interface Tasks 1-7 produced.
- Produces: the frozen primitive API. From here on no Wave 1 unit may change `src/ui/` or `src/index.css`.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS across every workspace and `typecheck:e2e`.

- [ ] **Step 2: Full unit suite**

Run: `npm run test`
Expected: PASS. Every pre-existing test must still pass — Wave 0 changed no screen.

- [ ] **Step 3: Confirm the old tokens are gone and nothing references them**

```bash
grep -rn "color-bg\|color-surface\|color-text\|color-primary\|color-border" apps/web/src --include=*.tsx | head -40
```

Expected: many hits. This is the Wave 1 work list — every hit is a call site a Wave 1 owner must convert. Record the count; it is the completion measure for Wave 1.

- [ ] **Step 4: Confirm the app still boots**

```bash
npm run db:up && npm run dev:api &
npm run dev:web
```

Open `http://127.0.0.1:5173/today`. Expected: the app renders. It will look wrong — unconverted call sites reference removed tokens — but it must not be blank, and the console must show no module resolution errors.

- [ ] **Step 5: Commit any fixes, then tag the gate**

```bash
git commit --allow-empty -m "Wave 0 gate: foundation green, primitives frozen"
```

---

# Wave 1 — Screens (parallel, one owner per unit)

Twelve units, file-disjoint, each with a single owner. `src/app/` lands first because it
defines the loading, error and empty-state primitives the other eleven consume. No unit may
edit a file outside its own directory, and none may edit `src/ui/` or `src/index.css` — those
belong to Wave 0 and are frozen once its gate passes.

Throughout, **the rework spec** means `docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md`.
It is a different document from `openspec/changes/build-initial-mvp/design.md`, which several
source files already cite as "design.md" for its D1–D40 decisions.

---

## Unit: Shell and chrome

### Task 9: The three shell status primitives (LoadingState, ErrorState, EmptyState) and AppBootstrap wiring

**Files:**
- Create: `apps/web/src/ui/LoadingState.tsx`
- Create: `apps/web/src/ui/LoadingState.test.tsx`
- Create: `apps/web/src/ui/ErrorState.tsx`
- Create: `apps/web/src/ui/EmptyState.tsx`
- Create: `apps/web/src/ui/EmptyState.test.tsx`
- Modify: `apps/web/src/app/AppBootstrap.tsx`
- Modify: `apps/web/src/app/AppBootstrap.test.tsx`

**Interfaces:**
- Consumes: `cn(...inputs: ClassValue[]): string` (`../lib/cn.js`); `Skeleton` (`./shadcn/skeleton.js`); `Alert`, `AlertTitle`, `AlertDescription` (`./shadcn/alert.js`); `Button` (`./Button.js`); `useMe()` (`../lib/query/hooks.js`, unchanged). ErrorState's markup below assumes current shadcn codegen for `Alert`/`AlertDescription`: `Alert` puts `role="alert"` on its own root element, and `AlertDescription` renders a `<div>` (not a `<p>`), so nesting a `<Button>` inside it is valid HTML. `apps/web/src/ui/shadcn/alert.tsx` does not exist in this repo yet (Wave 0 has not run) — re-check this assumption against the file Wave 0 actually installs before trusting the diff below verbatim.
- Produces (frozen for every other unit from here on):
  ```ts
  // src/ui/LoadingState.tsx
  export interface LoadingStateProps {
    readonly children: string
    readonly rows?: number
    readonly className?: string
  }
  export function LoadingState(props: LoadingStateProps): ReactElement
  // <div aria-busy="true">, children rendered as visible text, then `rows`
  // (default 1) static (non-pulsing) Skeleton placeholder rows, each carrying
  // data-testid="loading-state-row".

  // src/ui/ErrorState.tsx
  export interface ErrorStateProps {
    readonly children: string
    readonly onRetry: () => void
    readonly retryLabel?: string
    readonly retryDisabled?: boolean
  }
  export function ErrorState(props: ErrorStateProps): ReactElement
  // shadcn <Alert role="alert"> wrapping the message (AlertTitle) and a
  // Button (AlertDescription) calling onRetry. retryLabel defaults to
  // 'Retry' — every existing call site keeps that exact accessible name.

  // src/ui/EmptyState.tsx
  export interface EmptyStateProps {
    readonly children: string
    readonly action?: ReactNode
    readonly className?: string
  }
  export function EmptyState(props: EmptyStateProps): ReactElement
  // One hairline (border-t border-rule) above muted message text and an
  // optional action node. No card, no icon.
  ```

- [ ] **Step 1: Write the failing tests**
```tsx
// apps/web/src/ui/LoadingState.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingState } from './LoadingState.js'

describe('LoadingState', () => {
  it('renders its label inside an aria-busy region with a static (non-pulsing) placeholder row', () => {
    const { container } = render(<LoadingState>Loading</LoadingState>)

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
    expect(region?.querySelector('[data-testid="loading-state-row"]')).not.toBeNull()
    expect(container).toHaveTextContent('Loading')
  })

  it('renders `rows` placeholder slots', () => {
    const { container } = render(<LoadingState rows={3}>Loading blocks</LoadingState>)

    expect(container.querySelectorAll('[data-testid="loading-state-row"]')).toHaveLength(3)
  })
})
```

```tsx
// apps/web/src/ui/EmptyState.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState.js'

describe('EmptyState', () => {
  it('renders the message and an optional action', () => {
    render(<EmptyState action={<button type="button">Add one</button>}>Nothing recorded yet</EmptyState>)

    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument()
  })

  it('renders with no action when none is given', () => {
    render(<EmptyState>Nothing recorded yet</EmptyState>)

    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
```

```tsx
// apps/web/src/app/AppBootstrap.test.tsx — add `within` to the existing
// @testing-library/react import, then add these two cases inside the
// existing `describe('AppBootstrap', () => { ... })` block, alongside the
// two tests already there.
  it('pending state renders inside an aria-busy region with a static placeholder row (no pulse)', async () => {
    respond('sessions.active', null)
    let resolveMe: (value: MeResponseValue) => void = () => {}
    mockApi.me.get.mockImplementation(
      () =>
        new Promise<MeResponseValue>((resolve) => {
          resolveMe = resolve
        }),
    )

    const { container } = renderWithProviders(
      <AppBootstrap>
        <div>Protected content</div>
      </AppBootstrap>,
    )

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
    expect(region?.querySelector('[data-testid="loading-state-row"]')).not.toBeNull()
    expect(container).toHaveTextContent('Loading')

    resolveMe(ME_LOCAL_DEMO)
    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument())
  })

  it('error state renders inside a shadcn alert region containing the message and Retry action', async () => {
    respond('sessions.active', null)
    reject('me.get', { status: 500, code: 'server_error' })

    renderWithProviders(
      <AppBootstrap>
        <div>Protected content</div>
      </AppBootstrap>,
    )

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Could not reach the server')).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- LoadingState`
Expected: FAIL — `Cannot find module './LoadingState.js'` (the component does not exist yet).

Run: `npm run test -w @attention-lab/web -- EmptyState`
Expected: FAIL — `Cannot find module './EmptyState.js'`.

Run: `npm run test -w @attention-lab/web -- AppBootstrap`
Expected: FAIL on the two new cases — `region?.querySelector('[data-testid="loading-state-row"]')` is `null` (today's markup is a bare `<div aria-busy="true">Loading</div>`, no placeholder row), and `screen.findByRole('alert')` times out (today's error branch is a plain `<div><p>…</p><Button>…</Button></div>` with no `role="alert"` anywhere). The two existing tests in this file keep passing throughout.

- [ ] **Step 3: Implement**
```tsx
// apps/web/src/ui/LoadingState.tsx
import { cn } from '../lib/cn.js'
import { Skeleton } from './shadcn/skeleton.js'

export interface LoadingStateProps {
  readonly children: string
  /** Number of static placeholder rows to draw below the label. Defaults to 1. */
  readonly rows?: number
  readonly className?: string
}

/**
 * The app-wide loading treatment (the rework spec §4, §8 "Shell and chrome"):
 * `aria-busy="true"` on the same element that holds the label, with a
 * static — never-pulsing — ruled placeholder row underneath, the same mark
 * as an absent value. Replaces every bare `<div aria-busy="true">Loading</div>`
 * in the app.
 */
export function LoadingState({ children, rows = 1, className }: LoadingStateProps) {
  return (
    <div aria-busy="true" className={cn('flex flex-col gap-2', className)}>
      <p className="text-sm text-ink-muted">{children}</p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} data-testid="loading-state-row" className="h-4 w-full" />
      ))}
    </div>
  )
}
```

```tsx
// apps/web/src/ui/ErrorState.tsx
import { Alert, AlertDescription, AlertTitle } from './shadcn/alert.js'
import { Button } from './Button.js'

export interface ErrorStateProps {
  readonly children: string
  readonly onRetry: () => void
  readonly retryLabel?: string
  readonly retryDisabled?: boolean
}

/**
 * The app-wide retry/error treatment (the rework spec §8 "Shell and chrome"):
 * a shadcn Alert (role="alert") carrying the message and a Retry action.
 * Replaces every hand-rolled `<div><p>message</p><Button>Retry</Button></div>`.
 * `retryLabel` defaults to 'Retry' so every existing call site's accessible
 * name is unchanged by adopting this component.
 */
export function ErrorState({ children, onRetry, retryLabel = 'Retry', retryDisabled = false }: ErrorStateProps) {
  return (
    <Alert>
      <AlertTitle>{children}</AlertTitle>
      <AlertDescription>
        <Button onClick={onRetry} disabled={retryDisabled}>
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
```

```tsx
// apps/web/src/ui/EmptyState.tsx
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.js'

export interface EmptyStateProps {
  readonly children: string
  readonly action?: ReactNode
  readonly className?: string
}

/**
 * The app-wide empty-state treatment (the rework spec §8 "Shell and chrome"):
 * one hairline above muted message text, with an optional action below it.
 * No card, no icon — structure comes from the hairline, matching every
 * other section boundary in the app.
 */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('border-t border-rule pt-6 text-sm text-ink-muted', className)}>
      <p>{children}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
```

```diff
--- a/apps/web/src/app/AppBootstrap.tsx
+++ b/apps/web/src/app/AppBootstrap.tsx
@@
 import { useMe } from '../lib/query/hooks.js'
-import { Button } from '../ui/Button.js'
+import { LoadingState } from '../ui/LoadingState.js'
+import { ErrorState } from '../ui/ErrorState.js'
@@
   const { data, isPending, isError, refetch, isRefetching } = useMe()

   if (isPending) {
-    return <div aria-busy="true">Loading</div>
+    return <LoadingState>Loading</LoadingState>
   }

   if (isError || data === undefined) {
     return (
-      <div>
-        <p>Could not reach the server</p>
-        <Button
-          onClick={() => {
-            void refetch()
-          }}
-          disabled={isRefetching}
-        >
-          Retry
-        </Button>
-      </div>
+      <ErrorState
+        onRetry={() => {
+          void refetch()
+        }}
+        retryDisabled={isRefetching}
+      >
+        Could not reach the server
+      </ErrorState>
     )
   }
```

```diff
--- a/apps/web/src/app/AppBootstrap.test.tsx
+++ b/apps/web/src/app/AppBootstrap.test.tsx
@@
-import { cleanup, screen, waitFor } from '@testing-library/react'
+import { cleanup, screen, waitFor, within } from '@testing-library/react'
```
(then add the two new `it` blocks from Step 1 inside the existing `describe('AppBootstrap', ...)`.)

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- LoadingState EmptyState AppBootstrap`
Expected: PASS — all 8 cases: 2 in `LoadingState.test.tsx`, 2 in `EmptyState.test.tsx`, and all 4 in `AppBootstrap.test.tsx` (the 2 pre-existing cases — `children are not rendered until /me resolves` and `/me failure shows Could not reach the server and Retry refetches exactly once` — plus the 2 new ones added in Step 1).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/ui/LoadingState.tsx apps/web/src/ui/LoadingState.test.tsx apps/web/src/ui/ErrorState.tsx apps/web/src/ui/EmptyState.tsx apps/web/src/ui/EmptyState.test.tsx apps/web/src/app/AppBootstrap.tsx apps/web/src/app/AppBootstrap.test.tsx
git commit -m "Add LoadingState, ErrorState and EmptyState shell primitives; wire AppBootstrap onto them"
```

---

### Task 10: DemoBanner and RailLayout onto the new tokens

**Files:**
- Modify: `apps/web/src/app/DemoBanner.tsx`
- Modify: `apps/web/src/app/DemoBanner.test.tsx`
- Modify: `apps/web/src/app/layouts/RailLayout.tsx`
- Modify: `apps/web/src/app/layouts/RailLayout.test.tsx`

**Interfaces:**
- Consumes: `useMeContext()` (`../AppBootstrap.js`, unchanged); `useMediaQuery(query: string): boolean` (`../../lib/a11y/useMediaQuery.js`, unchanged)
- Produces: nothing — leaf task. (`NavItemProps` drops its unused `icon` field; nothing else imports `NavItem` directly, confirmed by repo-wide search.)

- [ ] **Step 1: Write the failing tests**
```tsx
// apps/web/src/app/DemoBanner.test.tsx — add inside the existing
// `describe('DemoBanner', () => { ... })` block.
  it('banner markup uses the new design tokens, not the retired --color- custom properties', async () => {
    mountBanner(ME_LOCAL_DEMO)

    const banner = await screen.findByLabelText('Demonstration data notice')
    expect(banner.className).not.toMatch(/--color-/)
  })
```

```tsx
// apps/web/src/app/layouts/RailLayout.test.tsx — add inside the existing
// `describe('RailLayout', () => { ... })` block.
  it('rendered rail markup uses the new design tokens, not the retired --color- custom properties', async () => {
    const { container } = mount('/progress')
    await screen.findByRole('navigation', { name: 'Main' })

    expect(container.innerHTML).not.toMatch(/--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- DemoBanner`
Expected: FAIL — `banner.className` is `"sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center text-sm text-[var(--color-text)]"`, which matches `/--color-/`.

Run: `npm run test -w @attention-lab/web -- RailLayout`
Expected: FAIL — the rendered nav, skip link and active `NavItem` all still carry `var(--color-*)` arbitrary-value classes.

- [ ] **Step 3: Implement**
```diff
--- a/apps/web/src/app/DemoBanner.tsx
+++ b/apps/web/src/app/DemoBanner.tsx
@@
   return (
     <aside
       aria-label="Demonstration data notice"
-      className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center text-sm text-[var(--color-text)]"
+      className="sticky top-0 z-50 border-b border-rule bg-paper px-4 py-2 text-center text-sm text-ink"
     >
       This is synthetic demonstration data — not a real measurement.
     </aside>
   )
```
`text-ink`, not `text-ink-muted`: the banner's own docstring quotes the identity-realm spec — "Demo mode is permanently and unmistakably labeled" — and `ink-muted` is the taxonomy's "not a value" tier (the rework spec §5). De-emphasizing this notice would contradict "unmistakably"; the token swap keeps its original full-ink weight.

```diff
--- a/apps/web/src/app/layouts/RailLayout.tsx
+++ b/apps/web/src/app/layouts/RailLayout.tsx
@@
-import type { ReactNode } from 'react'
 import { NavLink, Outlet } from 'react-router'
@@
 export interface NavItemProps {
   readonly to: string
   readonly label: string
-  /** Decorative only; the accessible name always comes from `label`. */
-  readonly icon?: ReactNode
 }
@@
-export function NavItem({ to, label, icon }: NavItemProps) {
+export function NavItem({ to, label }: NavItemProps) {
   return (
     <NavLink
       to={to}
       className={({ isActive }) =>
         [
           'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1',
           'rounded-md px-2 py-1 text-sm font-medium',
           'md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3',
-          isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
+          isActive ? 'text-signal' : 'text-ink-muted hover:text-ink',
         ].join(' ')
       }
     >
-      {icon !== undefined ? <span aria-hidden="true">{icon}</span> : null}
       <span>{label}</span>
     </NavLink>
   )
 }
@@
       <a
         href="#main"
-        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--color-bg)] focus:px-4 focus:py-2 focus:text-[var(--color-text)] focus:shadow"
+        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-paper focus:px-4 focus:py-2 focus:text-ink focus:shadow"
       >
         Skip to content
       </a>

       <nav
         aria-label="Main"
         data-placement={placement}
         className={
           placement === 'rail'
-            ? 'sticky top-0 flex h-dvh w-56 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3'
-            : 'fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1'
+            ? 'sticky top-0 flex h-dvh w-56 shrink-0 flex-col gap-1 border-r border-rule bg-paper p-3'
+            : 'fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-rule bg-paper px-1 py-1'
         }
       >
```
The skip link keeps `focus:shadow` unchanged and gains no new classes — only its two `--color-*` tokens are swapped (`--color-bg` → `paper`, matching the fact that the old page background *was* `--color-bg`; `--color-text` → `ink`). This task is a token rename only, so it must not add a new component-level focus affordance (the rework spec §6, "Per-component focus rings are stripped" — the same section that forbids a hover-and-focus underline forbids inventing a new reveal treatment here too); the pre-existing shadow-based reveal is preserved exactly.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- DemoBanner RailLayout`
Expected: PASS — all cases, including the pre-existing four-link, active-link, breakpoint, banner-order and single-main-landmark assertions, unmodified by this change.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/DemoBanner.tsx apps/web/src/app/DemoBanner.test.tsx apps/web/src/app/layouts/RailLayout.tsx apps/web/src/app/layouts/RailLayout.test.tsx
git commit -m "Move DemoBanner and RailLayout onto the paper/rule/ink/signal tokens; drop the unused NavItem icon slot"
```

---

### Task 11: SessionLeaveGuard onto the shadcn AlertDialog wrapper

**Files:**
- Modify: `apps/web/src/app/SessionLeaveGuard.tsx`
- Modify: `apps/web/src/app/SessionLeaveGuard.test.tsx`

**Interfaces:**
- Consumes: `AlertDialog`, `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription` (`../ui/shadcn/alert-dialog.js`); `Button` (`../ui/Button.js`, unchanged — still called directly with `onClick`, never through `AlertDialogAction`/`AlertDialogCancel`, so `blocker.reset()`/`blocker.proceed()` keep firing exactly once per click and `onOpenChange` still only ever fires from Escape, exactly as today)
- Produces: nothing — leaf task.

- [ ] **Step 1: Write the failing test**
```tsx
// apps/web/src/app/SessionLeaveGuard.test.tsx — add inside the existing
// `describe('SessionLeaveGuard', () => { ... })` block.
  it('dialog markup uses the new design tokens, not the retired --color- custom properties', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.innerHTML).not.toMatch(/--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- SessionLeaveGuard`
Expected: FAIL — the dialog's `Content`/`Title`/`Description` still carry `border-[var(--color-border)]`, `bg-[var(--color-bg)]`, `text-[var(--color-text)]` and `text-[var(--color-text-muted)]`, all matching `/--color-/`. The six pre-existing cases in this file keep passing.

- [ ] **Step 3: Implement**
```diff
--- a/apps/web/src/app/SessionLeaveGuard.tsx
+++ b/apps/web/src/app/SessionLeaveGuard.tsx
@@
 import { useRef } from 'react'
-import { AlertDialog } from 'radix-ui'
 import { useBlocker } from 'react-router'
 import { useQueryClient } from '@tanstack/react-query'
 import type { SessionResponseValue } from '@attention-lab/shared'

 import { queryKeys } from '../lib/query/keys.js'
 import { isActiveLifecycle } from '../lib/query/sessionMode.js'
 import { Button } from '../ui/Button.js'
+import {
+  AlertDialog,
+  AlertDialogContent,
+  AlertDialogDescription,
+  AlertDialogTitle,
+} from '../ui/shadcn/alert-dialog.js'
@@
   return (
-    <AlertDialog.Root
+    <AlertDialog
       open={isBlocked}
       onOpenChange={(nextOpen) => {
         // The only way `onOpenChange(false)` fires here is Escape —
         // AlertDialogContent already prevents outside-pointer/interact
         // dismissal, and both buttons below call `blocker.reset()` /
         // `blocker.proceed()` directly rather than going through Radix's
         // Close/Cancel/Action primitives, so no click ever reaches this
         // handler. "Escape behaves as Return" (D38).
         if (!nextOpen && blocker.state === 'blocked') {
           blocker.reset()
         }
       }}
     >
-      <AlertDialog.Portal>
-        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
-        <AlertDialog.Content
-          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg"
-          onOpenAutoFocus={(event) => {
-            event.preventDefault()
-            actionsRef.current?.querySelector('button')?.focus()
-          }}
-        >
-          <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
-            A session is in progress
-          </AlertDialog.Title>
-          <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
-            Your session keeps running on the server. Leaving this page does not end or change it.
-          </AlertDialog.Description>
-          <div ref={actionsRef} className="mt-6 flex justify-end gap-3">
-            <Button
-              variant="primary"
-              onClick={() => {
-                if (blocker.state === 'blocked') {
-                  blocker.reset()
-                }
-              }}
-            >
-              Return to session
-            </Button>
-            <Button
-              variant="secondary"
-              onClick={() => {
-                if (blocker.state === 'blocked') {
-                  blocker.proceed()
-                }
-              }}
-            >
-              Leave anyway
-            </Button>
-          </div>
-        </AlertDialog.Content>
-      </AlertDialog.Portal>
-    </AlertDialog.Root>
+      <AlertDialogContent
+        className="w-[min(24rem,calc(100vw-2rem))]"
+        onOpenAutoFocus={(event) => {
+          event.preventDefault()
+          actionsRef.current?.querySelector('button')?.focus()
+        }}
+      >
+        <AlertDialogTitle>A session is in progress</AlertDialogTitle>
+        <AlertDialogDescription>
+          Your session keeps running on the server. Leaving this page does not end or change it.
+        </AlertDialogDescription>
+        <div ref={actionsRef} className="mt-6 flex justify-end gap-3">
+          <Button
+            variant="primary"
+            onClick={() => {
+              if (blocker.state === 'blocked') {
+                blocker.reset()
+              }
+            }}
+          >
+            Return to session
+          </Button>
+          <Button
+            variant="secondary"
+            onClick={() => {
+              if (blocker.state === 'blocked') {
+                blocker.proceed()
+              }
+            }}
+          >
+            Leave anyway
+          </Button>
+        </div>
+      </AlertDialogContent>
+    </AlertDialog>
   )
 }
```
`AlertDialogContent` already renders its own `AlertDialogPortal`/`AlertDialogOverlay` internally (the shadcn-generated wrapper), so this task drops the explicit `.Portal`/`.Overlay` usage rather than reimplementing it.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- SessionLeaveGuard`
Expected: PASS — all seven cases: the new token-regression case plus the six pre-existing ones (dialog-on-navigate, Return to session, Leave anyway, focus/review not blocked, no-active-session, Tab-and-Escape).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/SessionLeaveGuard.tsx apps/web/src/app/SessionLeaveGuard.test.tsx
git commit -m "Move SessionLeaveGuard onto the shadcn AlertDialog wrapper"
```

---

### Task 12: NotFound and RouteError onto Button asChild

**Files:**
- Modify: `apps/web/src/app/NotFound.tsx`
- Create: `apps/web/src/app/NotFound.test.tsx`
- Modify: `apps/web/src/app/RouteError.tsx`
- Create: `apps/web/src/app/RouteError.test.tsx`

**Interfaces:**
- Consumes: `Button` with `asChild` (`../ui/Button.js` — renders the child element itself via Radix Slot rather than a `<button>` wrapping it, so nesting an anchor never produces invalid nested-interactive markup or changes its role)
- Produces: nothing — leaf task. `router.tsx` and `router.test.tsx` are centrally wired by task 7.1.1 and are not part of this unit's ownership, but this task's markup changes still have to keep their existing assertions passing unmodified: `findByText('This page is not available')` (router.test.tsx:160) and `getByRole('link', { name: 'Go to Today' })` (router.test.tsx:164) against the real `NotFound`, plus the two `queryByText('Something went wrong').not.toBeInTheDocument()` negative checks (router.test.tsx:133, :142) — these assert the root error boundary is never reached while visiting real routes, which this task cannot affect since it only restyles `RouteError`'s own markup, not when the router mounts it.

- [ ] **Step 1: Write the failing tests**
```tsx
// apps/web/src/app/NotFound.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { NotFound } from './NotFound.js'

describe('NotFound', () => {
  it('renders the heading and a Go to Today link, styled as a Button but never nested inside one', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'This page is not available' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Go to Today' })
    expect(link).toHaveAttribute('href', '/today')
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.closest('button')).toBeNull()
  })
})
```

```tsx
// apps/web/src/app/RouteError.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { RouteError } from './RouteError.js'

describe('RouteError', () => {
  it('renders the heading and a Go to Today link, styled as a Button but never nested inside one, and no diagnostic detail', () => {
    render(
      <MemoryRouter>
        <RouteError />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Go to Today' })
    expect(link).toHaveAttribute('href', '/today')
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.closest('button')).toBeNull()

    expect(screen.queryByText(/error|stack|exception/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- NotFound`
Expected: FAIL — `Cannot find module './NotFound.test.tsx'` counterpart aside, the assertion `expect(link).toHaveAttribute('data-variant', 'primary')` fails: today's `<Link>` is a bare, unstyled anchor with no `data-variant` attribute at all.

Run: `npm run test -w @attention-lab/web -- RouteError`
Expected: FAIL — same `data-variant` assertion fails for the same reason.

- [ ] **Step 3: Implement**
```diff
--- a/apps/web/src/app/NotFound.tsx
+++ b/apps/web/src/app/NotFound.tsx
@@
 import { Link } from 'react-router'
+import { Button } from '../ui/Button.js'

 /**
  * Rendered for any path under the rail layout that matches no known route
  * (the '*' leaf of the 'rail' route group in router.tsx).
  */
 export function NotFound() {
   return (
-    <main>
-      <h1>This page is not available</h1>
-      <p>
-        <Link to="/today">Go to Today</Link>
-      </p>
-    </main>
+    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
+      <h1 className="text-lg font-medium text-ink">This page is not available</h1>
+      <Button asChild>
+        <Link to="/today">Go to Today</Link>
+      </Button>
     </main>
   )
 }
```

```diff
--- a/apps/web/src/app/RouteError.tsx
+++ b/apps/web/src/app/RouteError.tsx
@@
 import { Link } from 'react-router'
+import { Button } from '../ui/Button.js'

 /**
  * The router's `errorElement`. Deliberately does not call `useRouteError()`
  * — the app-shell spec's "Implementation details are not user-facing"
  * requirement means this screen must never render an error message, a
  * stack trace, a request id or any other diagnostic detail, however the
  * route failed.
  */
 export function RouteError() {
   return (
-    <main>
-      <h1>Something went wrong</h1>
-      <p>
-        <Link to="/today">Go to Today</Link>
-      </p>
-    </main>
+    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
+      <h1 className="text-lg font-medium text-ink">Something went wrong</h1>
+      <Button asChild>
+        <Link to="/today">Go to Today</Link>
+      </Button>
     </main>
   )
 }
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- NotFound RouteError`
Expected: PASS.

Run: `npm run test -w @attention-lab/web -- router`
Expected: PASS unmodified — `router.test.tsx`'s `findByText('This page is not available')` (line 160), `getByRole('link', { name: 'Go to Today' })` (line 164), and both `queryByText('Something went wrong').not.toBeInTheDocument()` checks (lines 133, 142) still hold: the heading text, link text and `href` are unchanged, only the link's styling and wrapping element changed.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/NotFound.tsx apps/web/src/app/NotFound.test.tsx apps/web/src/app/RouteError.tsx apps/web/src/app/RouteError.test.tsx
git commit -m "Style the NotFound and RouteError Go-to-Today links as a Button via asChild"
```

---

## Unit: Today

### Task 13: Today's shell onto tokens — header hairline, `ErrorState` retry, `LoadingState` loading

**Files:**
- Modify: `apps/web/src/features/today/Today.tsx`
- Test: `apps/web/src/features/today/Today.test.tsx`

**Interfaces:**
- Consumes: `LoadingState` (`../../ui/LoadingState.js`, frozen: `LoadingState({ children: string, rows?:
  number, className?: string }) => ReactElement` — `<div aria-busy="true">` with `children` rendered as
  visible text, then `rows` (default 1) static, non-pulsing `Skeleton` placeholder rows, each carrying
  `data-testid="loading-state-row"`); `ErrorState` (`../../ui/ErrorState.js`, frozen: `ErrorState({
  children: string, onRetry: () => void, retryLabel?: string, retryDisabled?: boolean }) => ReactElement`
  — a shadcn `<Alert role="alert">` wrapping the message in `AlertTitle` and a `Button` calling
  `onRetry` inside `AlertDescription`; `retryLabel` defaults to `'Retry'`, so this call site's
  accessible name is unchanged). These are the shell unit's frozen status primitives (01-shell.md, task
  9) — Today's loading and error branches consume them rather than hand-rolling `Alert`/`Skeleton`
  markup of their own. Tokens `bg-paper`, `text-ink`, `border-rule` (Tailwind utilities, no import
  needed).
- Produces: nothing new for other tasks — `RetryNotice` stays a private function in this file, now a
  thin wrapper around `ErrorState`.

- [ ] **Step 1: Write the failing test**

Add beside the existing `'fetch failure renders Retry and refetches on click'` case in
`apps/web/src/features/today/Today.test.tsx`:

```tsx
  it('fetch failure renders the notice as an alert region', async () => {
    reject('programs.current', { status: 500, code: 'server_error' })

    mountToday()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Today could not be loaded')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
```

This needs `within` added to the existing `@testing-library/react` import at the top of the file:

```tsx
import { cleanup, screen, within } from '@testing-library/react'
```

Also add these two regression guards beside the same case. They exist to catch the regression this
task must not reintroduce: the current pending branches render the visible text "Loading" inside their
`aria-busy="true"` element, and a screen reader announces it — a bare skeleton with no text content
would silently drop that. Both cases already pass against today's markup; they must stay green through
Step 3's switch onto `LoadingState`, not just after it:

```tsx
  it('programs.current pending keeps an accessible "Loading" label inside the aria-busy region', () => {
    mockApi.programs.current.mockImplementation(() => new Promise(() => {}))

    mountToday()

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
  })

  it('programs.today pending keeps an accessible "Loading" label inside the aria-busy region', async () => {
    respond('programs.current', currentFixture({ kind: 'progress' }))
    mockApi.programs.today.mockImplementation(() => new Promise(() => {}))

    mountToday()

    const label = await screen.findByText('Loading')
    expect(label.closest('[aria-busy="true"]')).not.toBeNull()
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx`
Expected: FAIL on the new alert-region test with `TestingLibraryElementError: Unable to find an
accessible element with the role "alert"` — the current `RetryNotice` renders a plain `<div><p>…</p>
<Button …/></div>` with no ARIA role at all, so `findByRole('alert')` times out. The two new pending-
state cases already pass against today's real markup (`<div aria-busy="true">Loading</div>` already
renders the label) — they are regression guards, not new-behavior tests, and must stay green after
Step 3 too. Every other pre-existing case in the file still passes.

- [ ] **Step 3: Implement**

Replace the import block at the top of the file — `Button` drops out (nothing in this file calls it
directly once `RetryNotice` is built on `ErrorState`) and the shell's two status primitives come in:

```tsx
// before
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { Button } from '../../ui/Button.js'
import { NextAction } from './NextAction.js'
import { BlockCard } from './BlockCard.js'
import { CheckinCard } from './CheckinCard.js'
import { SuggestionBanner } from './SuggestionBanner.js'
import { ActiveSessionCard } from './ActiveSessionCard.js'

// after
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { LoadingState } from '../../ui/LoadingState.js'
import { ErrorState } from '../../ui/ErrorState.js'
import { NextAction } from './NextAction.js'
import { BlockCard } from './BlockCard.js'
import { CheckinCard } from './CheckinCard.js'
import { SuggestionBanner } from './SuggestionBanner.js'
import { ActiveSessionCard } from './ActiveSessionCard.js'
```

Replace `RetryNotice` — it stays a private wrapper in this file, now over `ErrorState` instead of
hand-rolled `Alert`/`Button` markup:

```tsx
// before
function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div>
      <p>Today could not be loaded</p>
      <Button
        onClick={() => {
          onRetry()
        }}
      >
        Retry
      </Button>
    </div>
  )
}

// after
function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return <ErrorState onRetry={onRetry}>Today could not be loaded</ErrorState>
}
```

`ErrorState` renders its message in a shadcn `<Alert role="alert">` with no `variant` prop, i.e. its
default variant — never `variant="destructive"`. A fetch failure is not a destructive action; it stays
the same neutral, ink-text treatment as every other alert in this rework.

Replace both loading returns, inside `Today()`, with the shell's `LoadingState` — it keeps the exact
same accessible "Loading" label the current markup already renders, now with a static placeholder row
added rather than no row at all:

```tsx
// before (appears twice: currentQuery.isPending and todayQuery.isPending)
if (currentQuery.isPending) {
  return <div aria-busy="true">Loading</div>
}
// …
if (todayQuery.isPending) {
  return <div aria-busy="true">Loading</div>
}

// after
if (currentQuery.isPending) {
  return <LoadingState>Loading</LoadingState>
}
// …
if (todayQuery.isPending) {
  return <LoadingState>Loading</LoadingState>
}
```

Then the header hairline, unrelated to the loading/error swap above:

```tsx
// before
      <header>
        <h1 className="text-lg font-semibold text-[var(--color-text)]">{`Day ${today.day} of 14`}</h1>
      </header>

// after
      <header className="border-b border-rule pb-4">
        <h1 className="text-lg font-semibold text-ink">{`Day ${today.day} of 14`}</h1>
      </header>
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx`
Expected: PASS — all existing cases, the new alert-region case, and the two pending-state "Loading"
regression guards.

Then check the loading state visually, since the automated cases only assert structurally (an
`aria-busy` region containing a `data-testid="loading-state-row"` placeholder), not the animation
itself: run `npm run dev:api` and `npm run dev:web`, open `/today` with the browser's network panel
set to "Slow 3G" so the pending state holds for a moment, and confirm the visible "Loading" label is
still there, with a static ruled placeholder row beneath it — no pulsing/shimmer animation, and the
label itself must never disappear in favour of a bare bar.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/today/Today.tsx apps/web/src/features/today/Today.test.tsx
git commit -m "$(cat <<'EOF'
Today: consume the shared LoadingState/ErrorState shell primitives for loading and retry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 14: Add the aria-hidden 14-day position track

**Files:**
- Modify: `apps/web/src/features/today/Today.tsx`
- Test: `apps/web/src/features/today/Today.test.tsx`

**Interfaces:**
- Consumes: `today.day` (`TodayResponseValue['day']`, already destructured as `today` in this file);
  no other query or prop — the track must never read `today.checkin` or `today.blocks`, since `GET
  /programs/{id}/today` carries no per-day history and this must not imply recorded-versus-missing
  days.
- Produces: nothing exported — `DayPositionTrack` and `dayPosition` are private to this file.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/today/Today.test.tsx`, inside the `describe('Today', ...)` block,
beside the existing `'Day N of 14 uses the server day field even when the browser date differs'`
case:

```tsx
  it('day position track is aria-hidden, shows 14 markers and derives past/today/ahead from today.day alone', async () => {
    respond('programs.current', currentFixture({ kind: 'progress' }))
    respond('programs.today', todayFixture({ kind: 'progress' }, { day: 9 }))

    mountToday()

    await screen.findByRole('heading', { name: 'Day 9 of 14' })

    const track = screen.getByTestId('day-position-track')
    expect(track).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    const markers = track.querySelectorAll('[data-position]')
    expect(markers).toHaveLength(14)
    expect(markers[0]).toHaveAttribute('data-position', 'past')
    expect(markers[7]).toHaveAttribute('data-position', 'past')
    expect(markers[8]).toHaveAttribute('data-position', 'today')
    expect(markers[9]).toHaveAttribute('data-position', 'ahead')
    expect(markers[13]).toHaveAttribute('data-position', 'ahead')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx`
Expected: FAIL with `TestingLibraryElementError: Unable to find an element by: [data-testid="day-position-track"]`
— no such element exists yet.

- [ ] **Step 3: Implement**

Add above the `Today()` function in `apps/web/src/features/today/Today.tsx`:

```tsx
type DayPosition = 'past' | 'today' | 'ahead'

function dayPosition(trackDay: number, currentDay: number): DayPosition {
  if (trackDay < currentDay) {
    return 'past'
  }
  if (trackDay === currentDay) {
    return 'today'
  }
  return 'ahead'
}

/**
 * Position-only progress track: past, today or ahead, derived from
 * `today.day` alone. `GET /programs/{id}/today` returns no per-day history,
 * so this never reads `checkin` or `blocks` and must not imply a day was
 * recorded or missed — it is not a streak. `aria-hidden` because it carries
 * no information the "Day N of 14" heading does not already state
 * accessibly.
 */
function DayPositionTrack({ day }: { readonly day: number }) {
  const days = Array.from({ length: 14 }, (_, index) => index + 1)

  return (
    <ol aria-hidden="true" data-testid="day-position-track" className="flex gap-1">
      {days.map((trackDay) => (
        <li
          key={trackDay}
          data-position={dayPosition(trackDay, day)}
          className="h-1.5 flex-1 rounded-full bg-rule data-[position=past]:bg-ink-muted data-[position=today]:bg-signal"
        />
      ))}
    </ol>
  )
}
```

Place it right after the header inside `Today()`'s returned JSX:

```tsx
// before
      <header className="border-b border-rule pb-4">
        <h1 className="text-lg font-semibold text-ink">{`Day ${today.day} of 14`}</h1>
      </header>

      <section aria-label="Next action" className="flex flex-col gap-3">

// after
      <header className="border-b border-rule pb-4">
        <h1 className="text-lg font-semibold text-ink">{`Day ${today.day} of 14`}</h1>
      </header>

      <DayPositionTrack day={today.day} />

      <section aria-label="Next action" className="flex flex-col gap-3">
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx`
Expected: PASS, including every pre-existing case (`aria-hidden` keeps the track out of the
accessibility tree, so the nav-by-Tab and heading tests are unaffected).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/today/Today.tsx apps/web/src/features/today/Today.test.tsx
git commit -m "$(cat <<'EOF'
Today: add the aria-hidden 14-day position track (past/today/ahead only)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 15: BlockCard onto `Field`/`Textarea`/`Label`, hairline row — with the focus regression test

**Files:**
- Modify: `apps/web/src/features/today/BlockCard.tsx`
- Modify: `apps/web/src/features/today/Today.tsx`
- Test: `apps/web/src/features/today/BlockCard.test.tsx`
- Test: `apps/web/src/features/today/Today.test.tsx`

**Interfaces:**
- Consumes: `useField` (`../../ui/field.js`, frozen: `useField({ name, description?, error?,
  required? }) => FieldWiring`); the shadcn `label` and `textarea` primitives from Wave 0
  (`../../ui/shadcn/label.js` exporting `Label`, `../../ui/shadcn/textarea.js` exporting `Textarea`,
  both forwarding native props plus `className`, focus-visible classes stripped); `Button`
  (`../../ui/Button.js`, unchanged here). Tokens `text-ink`, `text-ink-muted`, `text-attention`,
  `border-rule`. Per the settled colour rule, amber on a *message* means the user must act:
  `StartPracticeForm`'s two `role="alert"` messages both take `text-attention`, not ink — "Required"
  is a validation error and "The session could not be started" is a failed save with a Retry beside
  it, and neither is exempt just because the underlying data isn't a measured value (see Step 3).
- Produces: `StartPracticeForm`'s and `BlockCard`'s exported names and props are unchanged — nothing
  new for other tasks.

This is the highest-risk file in this unit: `focusBlockStartForm` in `Today.tsx` finds `[data-block-
index="N"]` and focuses `container.querySelector('input, textarea, button, [tabindex]')` — the
*first* match. Restructuring `BlockCard`'s markup could silently reorder what that selector finds
first, and no existing test exercises the real click-to-focus path end to end (the `NextAction`
table-driven test in `Today.test.tsx` only asserts `onFocusBlock` was called with a mock, never that
focus actually lands). Both new tests below close that gap and must stay green through Step 3.

- [ ] **Step 1: Write the failing test**

Add beside `'empty output marks the field required and sends nothing'` in
`apps/web/src/features/today/BlockCard.test.tsx`:

```tsx
  it('the output field is marked aria-required and stays associated with its live counter for screen readers', () => {
    mount(defaultProps())

    const textbox = outputTextbox()
    expect(textbox).toHaveAttribute('aria-required', 'true')

    const counter = screen.getByText('0/200')
    expect(textbox.getAttribute('aria-describedby')).toContain(counter.id)
  })
```

Add beside `'Day N of 14 uses the server day field even when the browser date differs'` in
`apps/web/src/features/today/Today.test.tsx` (this one is a regression guard, not a new-behavior
test — it already passes against the current markup and must keep passing after Step 3 below rewires
`BlockCard`'s internals):

```tsx
  it("clicking Block 1 is next moves DOM focus into block 1's own start form (regression: BlockCard's markup must keep the textarea the first focusable descendant of [data-block-index])", async () => {
    respond('programs.current', currentFixture({ kind: 'practice', block: 1 }))
    respond('programs.today', todayFixture({ kind: 'practice', block: 1 }))

    mountToday()

    const nextButton = await screen.findByRole('button', { name: 'Block 1 is next' })
    fireEvent.click(nextButton)

    const outputField = screen.getByRole('textbox', { name: 'What will you produce?' })
    expect(outputField).toHaveFocus()
    expect(outputField.closest('[data-block-index="1"]')).not.toBeNull()
  })
```

This needs `fireEvent` added to the existing `@testing-library/react` import:

```tsx
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
```

(`within` here continues Task 13's addition to the same import line — the two tasks touch the same
line, so apply them in order.)

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- src/features/today/BlockCard.test.tsx src/features/today/Today.test.tsx`
Expected: FAIL on the new `BlockCard.test.tsx` case — `expect(textbox).toHaveAttribute('aria-required',
'true')` fails because the current hand-rolled `<textarea>` never sets `aria-required` at all. The new
`Today.test.tsx` focus-regression case passes already, against the current wiring — that is
intentional: it is here to catch a break introduced by Step 3, not to be red now.

- [ ] **Step 3: Implement**

In `apps/web/src/features/today/BlockCard.tsx`, replace the imports:

```tsx
// before
import { useId, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import type { SessionResponseValue, TodayBlockValue } from '@attention-lab/shared'

import { useStartSession } from '../../lib/query/useStartSession.js'
import { Button } from '../../ui/Button.js'

// after
import { useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import type { SessionResponseValue, TodayBlockValue } from '@attention-lab/shared'

import { useStartSession } from '../../lib/query/useStartSession.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
```

`useId` drops out of the `react` import — nothing in the file needs it once the id/aria wiring below
moves onto `useField`.

Then replace the whole `StartPracticeForm` function. This is the file's highest-risk edit, so both
blocks below are the real, complete function, not a summary — `attemptStart`, `handleChange` and
`handleStartClick` are reproduced byte-for-byte from the current source in both blocks; only the
id/aria wiring (three `useId()` calls -> one `useField()` call) and the two `role="alert"` messages'
markup actually change:

```tsx
// before
export function StartPracticeForm({ programId, targetSeconds, onStarted }: StartPracticeFormProps) {
  const [intendedOutput, setIntendedOutput] = useState('')
  const [textareaError, setTextareaError] = useState<string | null>(null)
  const [startFailed, setStartFailed] = useState(false)
  const navigate = useNavigate()
  const { start, status } = useStartSession()

  const textareaId = useId()
  const errorId = useId()
  const counterId = useId()
  const isPending = status === 'pending'
  const hasError = textareaError !== null

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value
    // Client-side truncation rather than relying on the `maxLength`
    // attribute alone: jsdom's `<textarea>` does not enforce it on a
    // programmatic value change the way a real browser does on typed input,
    // and a pasted/typed value beyond the limit must be blocked either way
    // (this task's own "> 200 blocked" validation rule).
    setIntendedOutput(next.length > MAX_OUTPUT_LENGTH ? next.slice(0, MAX_OUTPUT_LENGTH) : next)
  }

  async function attemptStart() {
    const trimmed = intendedOutput.trim()
    if (trimmed.length < 1) {
      setTextareaError('Required')
      setStartFailed(false)
      return
    }
    setTextareaError(null)
    setStartFailed(false)

    try {
      // No `slotId` — a practice session is never tied to a benchmark slot.
      const session = await start({
        programId,
        kind: 'practice',
        intendedOutput: trimmed,
        targetSeconds,
      })
      onStarted?.(session)
      navigate(`/focus/${session.id}`)
    } catch (thrown) {
      if (isApiErrorLike(thrown) && thrown.code === 'active_session_exists') {
        return
      }
      const message = isApiErrorLike(thrown) ? fieldErrorText(thrown.fieldErrors?.intendedOutput) : undefined
      if (message !== undefined) {
        setTextareaError(message)
        return
      }
      setStartFailed(true)
    }
  }

  function handleStartClick() {
    void attemptStart()
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={textareaId} className="text-sm font-medium text-[var(--color-text)]">
        What will you produce?
      </label>
      <textarea
        id={textareaId}
        value={intendedOutput}
        maxLength={MAX_OUTPUT_LENGTH}
        disabled={isPending}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={[counterId, hasError ? errorId : undefined]
          .filter((id): id is string => id !== undefined)
          .join(' ')}
        onChange={handleChange}
        className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <span id={counterId} className="text-xs text-[var(--color-text-muted)]">
        {`${intendedOutput.length}/${MAX_OUTPUT_LENGTH}`}
      </span>
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm">
          {textareaError}
        </p>
      ) : null}
      {startFailed ? (
        <p role="alert" className="text-sm">
          The session could not be started
        </p>
      ) : null}
      <Button onClick={handleStartClick} disabled={isPending}>
        {startFailed ? 'Retry' : 'Start'}
      </Button>
    </div>
  )
}

// after
export function StartPracticeForm({ programId, targetSeconds, onStarted }: StartPracticeFormProps) {
  const [intendedOutput, setIntendedOutput] = useState('')
  const [textareaError, setTextareaError] = useState<string | null>(null)
  const [startFailed, setStartFailed] = useState(false)
  const navigate = useNavigate()
  const { start, status } = useStartSession()

  const isPending = status === 'pending'
  const counterText = `${intendedOutput.length}/${MAX_OUTPUT_LENGTH}`
  const field = useField({
    name: 'intended-output',
    description: counterText,
    error: textareaError,
    required: true,
  })

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value
    // Client-side truncation rather than relying on the `maxLength`
    // attribute alone: jsdom's `<textarea>` does not enforce it on a
    // programmatic value change the way a real browser does on typed input,
    // and a pasted/typed value beyond the limit must be blocked either way
    // (this task's own "> 200 blocked" validation rule).
    setIntendedOutput(next.length > MAX_OUTPUT_LENGTH ? next.slice(0, MAX_OUTPUT_LENGTH) : next)
  }

  async function attemptStart() {
    const trimmed = intendedOutput.trim()
    if (trimmed.length < 1) {
      setTextareaError('Required')
      setStartFailed(false)
      return
    }
    setTextareaError(null)
    setStartFailed(false)

    try {
      // No `slotId` — a practice session is never tied to a benchmark slot.
      const session = await start({
        programId,
        kind: 'practice',
        intendedOutput: trimmed,
        targetSeconds,
      })
      onStarted?.(session)
      navigate(`/focus/${session.id}`)
    } catch (thrown) {
      if (isApiErrorLike(thrown) && thrown.code === 'active_session_exists') {
        return
      }
      const message = isApiErrorLike(thrown) ? fieldErrorText(thrown.fieldErrors?.intendedOutput) : undefined
      if (message !== undefined) {
        setTextareaError(message)
        return
      }
      setStartFailed(true)
    }
  }

  function handleStartClick() {
    void attemptStart()
  }

  return (
    <div className="flex flex-col gap-2">
      <Label {...field.labelProps} className="text-sm font-medium text-ink">
        What will you produce?
      </Label>
      <Textarea
        {...field.controlProps}
        value={intendedOutput}
        maxLength={MAX_OUTPUT_LENGTH}
        disabled={isPending}
        onChange={handleChange}
        className="min-h-20 w-full"
      />
      {field.descriptionProps !== undefined ? (
        <span {...field.descriptionProps} className="text-xs text-ink-muted">
          {counterText}
        </span>
      ) : null}
      {field.errorProps !== undefined && textareaError !== null ? (
        <p {...field.errorProps} className="text-sm text-attention">
          {textareaError}
        </p>
      ) : null}
      {startFailed ? (
        <p role="alert" className="text-sm text-attention">
          The session could not be started
        </p>
      ) : null}
      <Button onClick={handleStartClick} disabled={isPending}>
        {startFailed ? 'Retry' : 'Start'}
      </Button>
    </div>
  )
}
```

Both `role="alert"` messages take `text-attention`, never ink or destructive: per the settled colour
rule, amber on a *message* means the user must act — "Required" is a validation error and "The session
could not be started" is a failed save with its own Retry beside it (the `Button` itself relabels to
"Retry" when `startFailed` is true), so both are needs-you messages regardless of whether the
underlying data is a measured value. Destructive styling stays reserved for a destructive action's own
confirmation (Reset demo data, Abandon session), never for an error banner. `field.errorProps` already
carries `role: 'alert'` from `useField`, which is why the first paragraph no longer sets the attribute
itself; `startFailed`'s paragraph is not wired through `useField` at all (it is not a per-field
validation error) and keeps its own literal `role="alert"`, unchanged.

Then re-skin `BlockCard`'s own wrapper into a hairline row instead of a boxed card (`BlockCard` is a
plain block in the one-column log, never the `Card` primitive):

```tsx
// before
export function BlockCard({ block, target, isNext, programId }: BlockCardProps) {
  return (
    <div
      data-status={block.status}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-text)]">{`Block ${block.index}`}</span>
        <span className="text-sm text-[var(--color-text-muted)]">{STATUS_LABEL[block.status]}</span>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">{formatMinutes(target)}</p>
      {isNext && block.status === 'not_started' ? (
        <StartPracticeForm programId={programId} targetSeconds={target} />
      ) : null}
    </div>
  )
}

// after
export function BlockCard({ block, target, isNext, programId }: BlockCardProps) {
  return (
    <div data-status={block.status} className="flex flex-col gap-3 border-b border-rule py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{`Block ${block.index}`}</span>
        <span className="text-sm text-ink-muted">{STATUS_LABEL[block.status]}</span>
      </div>
      <p className="text-sm text-ink-muted">{formatMinutes(target)}</p>
      {isNext && block.status === 'not_started' ? (
        <StartPracticeForm programId={programId} targetSeconds={target} />
      ) : null}
    </div>
  )
}
```

Since `BlockCard` now supplies its own hairline and vertical rhythm, drop the redundant gap around it
in `apps/web/src/features/today/Today.tsx`:

```tsx
// before
      <section aria-label="Practice blocks" className="flex flex-col gap-3">

// after
      <section aria-label="Practice blocks">
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- src/features/today/BlockCard.test.tsx src/features/today/Today.test.tsx`
Expected: PASS — every pre-existing `BlockCard.test.tsx` case (including the retry/idempotency-key
and all-four-status-badge cases, none of which depend on the removed inline classes), the new
`aria-required` case, and both `Today.test.tsx` cases (the day-position and the new focus-regression
one) all green.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/today/BlockCard.tsx apps/web/src/features/today/Today.tsx apps/web/src/features/today/BlockCard.test.tsx apps/web/src/features/today/Today.test.tsx
git commit -m "$(cat <<'EOF'
Today: move BlockCard's start form onto Field/Textarea/Label, hairline row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 16: NextAction/CheckinCard/SuggestionBanner — `Reported`, `asChild`, and the single-primary demotions

**Files:**
- Modify: `apps/web/src/features/today/NextAction.tsx`
- Modify: `apps/web/src/features/today/CheckinCard.tsx`
- Modify: `apps/web/src/features/today/SuggestionBanner.tsx`
- Test: `apps/web/src/features/today/Today.test.tsx`
- Test: `apps/web/src/features/today/CheckinCard.test.tsx`
- Test: `apps/web/src/features/today/SuggestionBanner.test.tsx`

**Interfaces:**
- Consumes: `Button` with `asChild` (frozen: `ButtonProps.asChild?: boolean`, renders the child via
  Radix `Slot`, never a button wrapping an anchor); `Reported` (`../../ui/Reported.js`, frozen:
  `Reported({ children: string, mono?: boolean, className?: string })`, renders `<span
  data-tier={tier}>` from `absenceTier(children)`). Tokens `text-ink`, `text-ink-muted`, `border-rule`.
  No `text-attention` in this file: `SuggestionBanner`'s mutation-failure message is request-failure
  copy, not a measured value, so it also keeps the neutral ink treatment (see Step 3).
- Produces: nothing — all three components' exported names and props are unchanged.

Three independent, mechanical changes, landed together because each is small and each is exercised
by an existing standalone-slot test file: (1) `NextAction`'s five link cases retire the hand-rolled
`LINK_CLASSES` constant for `Button asChild`, and its `practice` case demotes to `variant="quiet"`;
(2) `CheckinCard` wraps its two null-or-`0` values in `<Reported>` and its own link retires
`LINK_CLASSES` the same way; (3) `SuggestionBanner`'s `Accept` demotes to `variant="secondary"` so
`BlockCard`'s `Start` stays the screen's only primary control, per the rework spec §6 ("One primary per
interactive surface"), and its 409/400 mutation-failure message drops the amber it currently carries
in favour of ink text, since destructive/amber styling belongs to actions and to uncertain *data*
respectively, never to a request-failure banner.

- [ ] **Step 1: Write the failing test**

Add to the `describe('NextAction', ...)` block in `apps/web/src/features/today/Today.test.tsx`,
beside the existing `'renders exactly one primary control with the right href for each nextAction
value…'` case:

```tsx
  it('practice next action renders as the quiet variant so BlockCard\'s own Start stays the only primary control', () => {
    renderWithProviders(
      <NextAction
        nextAction={{ kind: 'practice', block: 1 }}
        programId="program-1"
        slots={ALL_SLOTS}
        onFocusBlock={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Block 1 is next' })).toHaveAttribute('data-variant', 'quiet')
  })

  it('benchmark next action link still carries data-variant primary via Button asChild', () => {
    renderWithProviders(
      <NextAction
        nextAction={{ kind: 'benchmark', slotId: 'slot-baseline-a' }}
        programId="program-1"
        slots={ALL_SLOTS}
        onFocusBlock={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'Start with your baseline' })).toHaveAttribute(
      'data-variant',
      'primary',
    )
  })
```

Add to `apps/web/src/features/today/CheckinCard.test.tsx`, beside `'explicit zero feed value renders
0 min while a null value renders not yet reported'`:

```tsx
  it('sleep and feed values are wrapped in Reported with the correct data-tier', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: ['sleep'],
        values: { sleepMinutes: null, phoneFeedMinutes: 0, desktopFeedMinutes: 25 },
      }),
    )

    const sleepValue = screen.getByText('Sleep').nextElementSibling
    expect(sleepValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')

    const phoneValue = screen.getByText('Phone feed').nextElementSibling
    expect(phoneValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const desktopValue = screen.getByText('Desktop feed').nextElementSibling
    expect(desktopValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')
  })

  it('Open check-in link carries data-variant secondary via Button asChild', () => {
    mountCard(checkinFixture())

    expect(screen.getByRole('link', { name: 'Open check-in' })).toHaveAttribute('data-variant', 'secondary')
  })
```

Add to `apps/web/src/features/today/SuggestionBanner.test.tsx`, beside `'banner copy has no
/streak|unlock|level/i text'`:

```tsx
  it('Accept renders as the secondary variant so it is never a second primary alongside BlockCard\'s Start', () => {
    mount()

    expect(screen.getByRole('button', { name: 'Accept' })).toHaveAttribute('data-variant', 'secondary')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx src/features/today/CheckinCard.test.tsx src/features/today/SuggestionBanner.test.tsx`
Expected: FAIL on all five new cases —
`Block 1 is next` currently has `data-variant="primary"` (the `Button` default), not `quiet`;
the benchmark link is a raw `<a className={LINK_CLASSES}>` with no `data-variant` attribute at all;
`CheckinCard`'s sleep value is a plain text node with no `[data-tier]` descendant to find (the first
assertion in that test — the phone/desktop checks below it are never reached once it throws);
its "Open check-in" link is likewise a raw anchor with no `data-variant`;
and `SuggestionBanner`'s `Accept` currently has `data-variant="primary"`, not `secondary`.

- [ ] **Step 3: Implement**

`apps/web/src/features/today/NextAction.tsx` — delete the `LINK_CLASSES` constant (currently the two
lines directly below the `NextActionProps` interface) and rebuild every branch of `NextAction` itself
on `Button`. The two imports and the full `NextActionProps` interface above it, and the `slotLabel`
helper below it, are untouched — only these two pieces move:

```tsx
// delete
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95'
```

```tsx
// before
export function NextAction({ nextAction, slots, onFocusBlock }: NextActionProps) {
  switch (nextAction.kind) {
    case 'setup':
      return (
        <Link className={LINK_CLASSES} to="/setup">
          Set up your program
        </Link>
      )

    case 'readiness':
      return (
        <Link className={LINK_CLASSES} to="/setup/readiness">
          Finish readiness
        </Link>
      )

    case 'benchmark':
      return (
        <Link className={LINK_CLASSES} to={`/benchmark/${nextAction.slotId}`}>
          Start with your baseline
        </Link>
      )

    case 'practice':
      return (
        <Button
          onClick={() => {
            onFocusBlock(nextAction.block)
          }}
        >
          {`Block ${nextAction.block} is next`}
        </Button>
      )

    case 'final':
      return (
        <Link className={LINK_CLASSES} to={`/benchmark/${nextAction.slotId}`}>
          {`Final benchmark ${slotLabel(slots, nextAction.slotId)}`}
        </Link>
      )

    case 'progress':
      return (
        <Link className={LINK_CLASSES} to="/progress">
          View your progress
        </Link>
      )
  }
}

// after
export function NextAction({ nextAction, slots, onFocusBlock }: NextActionProps) {
  switch (nextAction.kind) {
    case 'setup':
      return (
        <Button asChild variant="primary">
          <Link to="/setup">Set up your program</Link>
        </Button>
      )

    case 'readiness':
      return (
        <Button asChild variant="primary">
          <Link to="/setup/readiness">Finish readiness</Link>
        </Button>
      )

    case 'benchmark':
      return (
        <Button asChild variant="primary">
          <Link to={`/benchmark/${nextAction.slotId}`}>Start with your baseline</Link>
        </Button>
      )

    case 'practice':
      return (
        <Button
          variant="quiet"
          onClick={() => {
            onFocusBlock(nextAction.block)
          }}
        >
          {`Block ${nextAction.block} is next`}
        </Button>
      )

    case 'final':
      return (
        <Button asChild variant="primary">
          <Link to={`/benchmark/${nextAction.slotId}`}>{`Final benchmark ${slotLabel(slots, nextAction.slotId)}`}</Link>
        </Button>
      )

    case 'progress':
      return (
        <Button asChild variant="primary">
          <Link to="/progress">View your progress</Link>
        </Button>
      )
  }
}
```

`apps/web/src/features/today/CheckinCard.tsx` — add two imports, delete its own `LINK_CLASSES`
constant, and wrap the two reported values. `CheckinCardProps`, `FIELD_LABEL` and `renderMinutes`
(the interface and two consts between the imports and `LINK_CLASSES`) are untouched by this task:

```tsx
// before
import { Link } from 'react-router'
import type { CheckinField, TodayResponseValue } from '@attention-lab/shared'

// after
import { Link } from 'react-router'
import type { CheckinField, TodayResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'
import { Reported } from '../../ui/Reported.js'
```

```tsx
// delete
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:brightness-95 self-start'
```

```tsx
// before
export function CheckinCard({ localDate, checkin }: CheckinCardProps) {
  const { status, missing, values } = checkin

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Check-in</h2>

      {status !== 'complete' && missing.length > 0 && (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          {`Still needed: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-[var(--color-text)]">
        <dt className="font-medium">Sleep</dt>
        <dd>{renderMinutes(values.sleepMinutes)}</dd>

        <dt className="font-medium">Phone feed</dt>
        <dd>{renderMinutes(values.phoneFeedMinutes)}</dd>

        <dt className="font-medium">Desktop feed</dt>
        <dd>{renderMinutes(values.desktopFeedMinutes)}</dd>
      </dl>

      <Link className={LINK_CLASSES} to={`/checkin/${localDate}`}>
        Open check-in
      </Link>
    </div>
  )
}

// after
export function CheckinCard({ localDate, checkin }: CheckinCardProps) {
  const { status, missing, values } = checkin

  return (
    <div className="flex flex-col gap-3 border-b border-rule py-4">
      <h2 className="text-sm font-semibold text-ink">Check-in</h2>

      {status !== 'complete' && missing.length > 0 && (
        <p role="status" className="text-sm text-ink-muted">
          {`Still needed: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-ink">
        <dt className="font-medium">Sleep</dt>
        <dd>
          <Reported>{renderMinutes(values.sleepMinutes)}</Reported>
        </dd>

        <dt className="font-medium">Phone feed</dt>
        <dd>
          <Reported>{renderMinutes(values.phoneFeedMinutes)}</Reported>
        </dd>

        <dt className="font-medium">Desktop feed</dt>
        <dd>
          <Reported>{renderMinutes(values.desktopFeedMinutes)}</Reported>
        </dd>
      </dl>

      <Button asChild variant="secondary" className="self-start">
        <Link to={`/checkin/${localDate}`}>Open check-in</Link>
      </Button>
    </div>
  )
}
```

`apps/web/src/features/today/SuggestionBanner.tsx` — demote `Accept`, move off the old tokens, and
drop the amber on the mutation-failure message:

```tsx
// before
  return (
    <div
      data-testid="suggestion-banner"
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-[var(--color-text)]">{`Ready for +5 minutes? (to ${suggestedMinutes} min)`}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {error !== null ? (
          <p role="alert" className="text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button
            variant="primary"
            disabled={createRevision.isPending}
            onClick={() => {
              void handleAccept()
            }}
          >
            Accept
          </Button>
          <Button variant="secondary" disabled={createRevision.isPending} onClick={handleHold}>
            Hold
          </Button>
        </div>
      </div>
    </div>
  )

// after
  return (
    <div
      data-testid="suggestion-banner"
      className="flex flex-col gap-3 border-b border-rule py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-ink">{`Ready for +5 minutes? (to ${suggestedMinutes} min)`}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {error !== null ? (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            disabled={createRevision.isPending}
            onClick={() => {
              void handleAccept()
            }}
          >
            Accept
          </Button>
          <Button variant="secondary" disabled={createRevision.isPending} onClick={handleHold}>
            Hold
          </Button>
        </div>
      </div>
    </div>
  )
```

The 409/400 mutation-failure text ("This program changed elsewhere. Refresh and try again." /
"Could not update. Retry." / a field-error string) is exactly the kind of banner the destructive-vs-
neutral rule is about: it is a request failure, not a destructive action and not an uncertain
*measurement*, so it keeps `role="alert"` (unchanged) with plain ink text (`text-ink`), never the
`attention` amber and never a destructive/red token.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- src/features/today/Today.test.tsx src/features/today/CheckinCard.test.tsx src/features/today/SuggestionBanner.test.tsx src/features/today/BlockCard.test.tsx`
Expected: PASS — including the pre-existing `NextAction` table-driven case (still exactly one link
and zero buttons for every link-kind case, since `Button asChild` renders only the child anchor), the
pre-existing `CheckinCard` cases (`.nextElementSibling` text-content assertions still match, since
`Reported` only adds a wrapping `<span>`), and the pre-existing `SuggestionBanner` cases (`Accept`
still triggers `handleAccept` regardless of its variant, and no case asserts on the error paragraph's
colour). `BlockCard.test.tsx` is included because it shares the same `renderWithProviders` harness and
is a cheap regression check that nothing in this file's changes leaked into it.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/today/NextAction.tsx apps/web/src/features/today/CheckinCard.tsx apps/web/src/features/today/SuggestionBanner.tsx apps/web/src/features/today/Today.test.tsx apps/web/src/features/today/CheckinCard.test.tsx apps/web/src/features/today/SuggestionBanner.test.tsx
git commit -m "$(cat <<'EOF'
Today: Reported values, Button asChild links, and the single-primary demotions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Active session card

### Task 17: Swap the raw container `<div>` for shadcn `Card` and retire the old container/text tokens

**Files:**
- Modify: `apps/web/src/features/session/ActiveSessionCard.tsx`
- Test: `apps/web/src/features/session/ActiveSessionCard.test.tsx`

**Interfaces:**
- Consumes: `Card` from `@/ui/shadcn/card.js`. This is a Wave 0 deliverable — `apps/web/src/ui/shadcn/`
  does not exist anywhere in the repository yet, so this task cannot start until Wave 0 has landed
  (design doc, "Implementation sequencing": "Nothing else starts until [Wave 0] is typechecking and
  green"). Wave 0 installs it per "Primitive layer": `Installed: button, card, input, ...`. The
  standard generated shadcn `Card` is a thin `React.ComponentProps<'div'>` wrapper that merges
  `className` through `cn()` and spreads the remaining props — including `data-testid` — onto its
  root `<div>`. Treat that prop-forwarding behavior as the working assumption, not a verified fact:
  if Wave 0's actual `card.js` forwards props differently (for example `data-testid` not reaching the
  root element), re-check Step 3 against the real file before implementing.
- Produces: nothing new — `ActiveSessionCardProps` and the exported `ActiveSessionCard(props)` signature are unchanged, so Today's and Benchmark Ready's existing imports of this component need no change

- [ ] **Step 1: Write the failing test**
Insert two lines at the very top of `apps/web/src/features/session/ActiveSessionCard.test.tsx`, before its existing first import line (`import { afterEach, describe, expect, it } from 'vitest'`) — this is the same `node:fs`/`node:url` pairing already used the same way in `src/lib/a11y/reducedMotion.test.ts`:
```tsx
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
```
Leave the file's other five existing import lines, the `makeSession` helper, and the entire existing `describe('ActiveSessionCard', ...)` block exactly as they are — do not touch them.

Then append this new `describe` block at the very end of the file, after the closing `})` of `describe('ActiveSessionCard', ...)`:
```tsx
describe('ActiveSessionCard token migration', () => {
  it('the card container and its text no longer reference the retired --color-border/surface/text-muted/text tokens', () => {
    const source = readFileSync(fileURLToPath(new URL('./ActiveSessionCard.tsx', import.meta.url)), 'utf8')

    expect(source).not.toMatch(/--color-border/)
    expect(source).not.toMatch(/--color-surface/)
    expect(source).not.toMatch(/--color-text-muted/)
    expect(source).not.toMatch(/--color-text\)/)
    expect(source).toContain('<Card')
    expect(source).not.toContain('CONTAINER_CLASSES')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- ActiveSessionCard`
Expected: FAIL — the new `it` fails on its *first* assertion, `expect(source).not.toMatch(/--color-border/)`, because the file still contains `var(--color-border)` inside `CONTAINER_CLASSES`. Vitest throws there and the `it` block stops; the other five checks (`--color-surface`, `--color-text-muted`, `--color-text)`, `<Card`, `CONTAINER_CLASSES`) are never evaluated in this run. The eight pre-existing tests keep passing.

- [ ] **Step 3: Implement**
Apply these three edits to `apps/web/src/features/session/ActiveSessionCard.tsx` as it exists today. Nothing outside these three spots changes: the module doc comment (lines 1-31), `ActiveSessionCardProps` (35-43), `Destination` (45-49) and `destinationFor` (70-110) are untouched.

Edit 1 — add the import. Find (appears once, lines 32-35):
```tsx
import { Link } from 'react-router'
import type { SessionResponseValue } from '@attention-lab/shared'

export interface ActiveSessionCardProps {
```
Replace with:
```tsx
import { Link } from 'react-router'
import type { SessionResponseValue } from '@attention-lab/shared'

import { Card } from '../../ui/shadcn/card.js'

export interface ActiveSessionCardProps {
```

Edit 2 — delete `CONTAINER_CLASSES`, leave `LINK_CLASSES` alone (it is retired separately, in Task 18). Find (appears once, lines 112-115):
```tsx
const CONTAINER_CLASSES =
  'flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4'
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95 self-start'
```
Replace with:
```tsx
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95 self-start'
```

Edit 3 — swap the container element and its two text classes. Find (appears once, lines 120-132):
```tsx
  return (
    <div className={CONTAINER_CLASSES} data-testid="active-session-card">
      {staleNotice ? (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          This session was updated in another tab
        </p>
      ) : null}
      <p className="text-sm text-[var(--color-text)]">{destination.description}</p>
      <Link className={LINK_CLASSES} to={destination.to}>
        {destination.label}
      </Link>
    </div>
  )
```
Replace with:
```tsx
  return (
    <Card data-testid="active-session-card" className="flex flex-col gap-2 p-4">
      {staleNotice ? (
        <p role="status" className="text-sm text-ink-muted">
          This session was updated in another tab
        </p>
      ) : null}
      <p className="text-sm text-ink">{destination.description}</p>
      <Link className={LINK_CLASSES} to={destination.to}>
        {destination.label}
      </Link>
    </Card>
  )
```

`Card` supplies the border, background and radius that `CONTAINER_CLASSES` used to hard-code; the
layout classes it doesn't cover (`flex flex-col gap-2 p-4`) move onto `Card`'s own `className`.
`LINK_CLASSES` (and its two `--color-primary*` references) is untouched here — it is retired in Task
16, which converts the Return control itself onto `Button asChild`.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- ActiveSessionCard`
Expected: PASS — all 8 pre-existing tests plus the new token-migration test (9 total).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/session/ActiveSessionCard.tsx apps/web/src/features/session/ActiveSessionCard.test.tsx
git commit -m "$(cat <<'EOF'
Move ActiveSessionCard's container onto shadcn Card

Card is reserved for genuinely raised things, and an active session is
one of them, so it replaces the hand-rolled bordered <div>. The
retired --color-border/--color-surface/--color-text/--color-text-muted
custom properties are gone from this file; the Return link's own
--color-primary* tokens are converted separately in the next task,
which also moves it onto Button asChild.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 18: Retire `LINK_CLASSES` — render the Return control as `<Button asChild><Link/></Button>`

**Files:**
- Modify: `apps/web/src/features/session/ActiveSessionCard.tsx`
- Test: `apps/web/src/features/session/ActiveSessionCard.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/ui/Button.js`. Its *current* shape (verified in the repository today) is
  `{ variant?: 'primary' | 'secondary' | 'quiet' } & ButtonHTMLAttributes<HTMLButtonElement>`, with no
  `asChild` prop and an unconditional `<button>` return — the design's "Four integration decisions"
  section is explicit that gaining `asChild` "requires real Radix `Slot` wiring, not a prop rename".
  That wiring is Wave 0 work (this section: "`Button` keeps its own variant names... The gain is
  `asChild`..."), so this task depends on Wave 0 having already added, by the time this step runs, an
  `asChild?: boolean` prop that renders the child element (a Radix `Slot`) instead of wrapping it in a
  `<button>`, while keeping `variant`'s default of `'primary'` and the existing `data-variant` output.
  If Wave 0's actual `Button.tsx` differs from this, re-check against the real file before implementing.
- Produces: nothing new — same as Task 17, `ActiveSessionCardProps`/`ActiveSessionCard` are unchanged

- [ ] **Step 1: Write the failing test**
Add one more `it` inside the existing `describe('ActiveSessionCard', ...)` block (next to `'running practice hides Start and links Return to /focus/:id'`), and extend the `describe('ActiveSessionCard token migration', ...)` block Task 17 added with a second, stricter `it`.
```tsx
// apps/web/src/features/session/ActiveSessionCard.test.tsx
// Inside describe('ActiveSessionCard', () => { ... }), added after the
// 'running practice hides Start and links Return to /focus/:id' test:
it('the Return control renders through Button asChild: a primary anchor, never a button wrapping it', () => {
  const session = makeSession({ id: 'session-a', kind: 'practice', lifecycle: 'running' })

  renderWithProviders(<ActiveSessionCard session={session} />)

  const link = screen.getByRole('link', { name: 'Return to your session' })
  expect(link).toHaveAttribute('data-variant', 'primary')
  expect(link.closest('button')).toBeNull()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
```
```tsx
// Inside describe('ActiveSessionCard token migration', () => { ... }),
// added after Task 17's 'the card container and its text no longer
// reference ...' test:
it('no legacy --color- custom property remains anywhere in the file', () => {
  const source = readFileSync(fileURLToPath(new URL('./ActiveSessionCard.tsx', import.meta.url)), 'utf8')

  expect(source).not.toMatch(/--color-/)
  expect(source).not.toContain('LINK_CLASSES')
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- ActiveSessionCard`
Expected: FAIL on two independent `it`s, each on its own first assertion:
- `'the Return control renders through Button asChild...'` — the preceding `getByRole('link', ...)` call succeeds (the element exists), but `expect(link).toHaveAttribute('data-variant', 'primary')` fails: the plain `<Link>` left by Task 17 carries no `data-variant` attribute at all. The remaining two assertions in that `it` are never reached.
- `'no legacy --color- custom property remains...'` fails on its first assertion, `expect(source).not.toMatch(/--color-/)`, because `LINK_CLASSES` still contains `var(--color-primary)` and `var(--color-primary-text)`; `expect(source).not.toContain('LINK_CLASSES')` is never reached in this run.

All prior tests (the 8 original plus Task 17's token-migration test) keep passing.

- [ ] **Step 3: Implement**
Apply these three edits to `apps/web/src/features/session/ActiveSessionCard.tsx` as Task 17 left it. Everything outside these three spots — `ActiveSessionCardProps`, `Destination`, `destinationFor`, and the module doc comment — stays untouched.

Edit 1 — add the `Button` import, alongside the existing `Card` import. Find (appears once):
```tsx
import { Card } from '../../ui/shadcn/card.js'

export interface ActiveSessionCardProps {
```
Replace with:
```tsx
import { Button } from '../../ui/Button.js'
import { Card } from '../../ui/shadcn/card.js'

export interface ActiveSessionCardProps {
```

Edit 2 — delete `LINK_CLASSES`. Find (appears once):
```tsx
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95 self-start'

export function ActiveSessionCard({ session, staleNotice = false }: ActiveSessionCardProps) {
```
Replace with:
```tsx
export function ActiveSessionCard({ session, staleNotice = false }: ActiveSessionCardProps) {
```

Edit 3 — replace the plain `Link` with `Button asChild` wrapping it. Find (appears once):
```tsx
      <p className="text-sm text-ink">{destination.description}</p>
      <Link className={LINK_CLASSES} to={destination.to}>
        {destination.label}
      </Link>
    </Card>
  )
}
```
Replace with:
```tsx
      <p className="text-sm text-ink">{destination.description}</p>
      <Button asChild className="self-start">
        <Link to={destination.to}>{destination.label}</Link>
      </Button>
    </Card>
  )
}
```

`LINK_CLASSES` is gone entirely. `Button`'s default `variant="primary"` supplies the fill, text
colour and hover/active states that `LINK_CLASSES` used to hard-code, plus the `data-variant="primary"`
attribute; `Button`'s own `min-h-11 min-w-11` supplies the tap target `LINK_CLASSES` used to spell out
by hand. `self-start` moves from `LINK_CLASSES` onto `Button`'s `className` so the control still hugs
the left edge of the card's flex column instead of stretching full width.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- ActiveSessionCard`
Expected: PASS — all 8 original tests, Task 17's token-migration test, and both new tests from this task (11 total).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/session/ActiveSessionCard.tsx apps/web/src/features/session/ActiveSessionCard.test.tsx
git commit -m "$(cat <<'EOF'
Render ActiveSessionCard's Return control via Button asChild

Retires the hand-rolled LINK_CLASSES constant, one of four duplicated
copies across the app (NextAction, CheckinCard, ActiveSessionCard and
ProgressEmptyState), per the shadcn rework design's "Four integration
decisions": "The gain is asChild, which retires the hand-rolled
LINK_CLASSES constant currently duplicated across NextAction,
CheckinCard, ActiveSessionCard and ProgressEmptyState." asChild renders
the real Radix Slot onto the Link's own anchor rather than wrapping it
in a <button>, so the control keeps its 'link' role and every
per-lifecycle accessible name exactly as before, while gaining
Button's data-variant="primary" and 44px tap target for free. No
--color-* custom property reference remains in this file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 19: Visual verification — Card reads as raised, the Return control is not stretched or double-bordered

This task changes no code. Tasks 15 and 16 are covered by the DOM-role and data-variant assertions above, plus the source-level token sweep; neither test can see actual box-model layout (jsdom does not run a real layout/paint engine), and "does this look like the one genuinely live thing on Today" per the design's "Type, structure, motion" and "Screens" sections is inherently a look-at-the-screen judgement. Rather than invent a fake layout assertion, this step is a real manual check with concrete pass/fail criteria.

**Files:**
- Verify only (no changes): `apps/web/src/features/session/ActiveSessionCard.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing — leaf verification task

- [ ] **Step 1: Start the app in local-demo mode**
Run (two terminals):
```bash
npm run db:up
npm run dev:api
```
```bash
npm run dev:web
```
Expected: the API logs it is listening on `127.0.0.1:8787` and the Vite server prints `http://127.0.0.1:5173/`. The permanent local-demo banner (CLAUDE.md: "fixed principal, loopback-only, synthetic fixture data, permanent demo banner") is visible on every screen.

- [ ] **Step 2: Get an active session onto Today, then look at the card**
Open `http://127.0.0.1:5173/today` in a browser. If no practice block is running yet, start one from a block's Start control so `ActiveSessionCard` mounts in place of it (per its own docstring, it renders "in place of their normal Start control only when [the active-session] query holds a session"). With the card visible, check:
- It reads as a distinct white/raised panel against the page's paper-grey background, with a visible hairline border — the only such panel on the Today screen besides the app shell's own chrome.
- The "Return to your session" control sits at the card's left edge, sized to its label plus padding — it does not stretch to the card's full width.
- The control is comfortably tappable (its box is visibly taller than the surrounding body text, consistent with the 44px minimum) and shows the app's single global focus ring — nothing else — when tabbed to.
- Nothing on the card is a second `Card` nested inside it (there is exactly one bordered panel here, not a panel-in-a-panel).

Expected: all four hold. If the card instead spans full width, shows no border, or the button stretches edge-to-edge, Task 17 or 16's `className` (`flex flex-col gap-2 p-4` on `Card`, `self-start` on `Button`) was dropped or overridden somewhere downstream (most likely by a wrapping element owned by the `features/today` unit — `Today.tsx` lives at `apps/web/src/features/today/Today.tsx`, not under `src/app/` — or by the `features/benchmark` unit's Ready screen, the two callers that mount this card) — file that as a cross-unit follow-up rather than re-opening Tasks 15/16, since this file's own classes are already covered by Step 1's guard test.

No commit — this task produces no diff.

---

## Unit: Setup: plan and readiness

### Task 20: PlanForm — plain inputs through `useField`, and the blank feed estimate made visible

**Files:**
- Modify: `apps/web/src/features/setup/PlanForm.tsx`
- Test: `apps/web/src/features/setup/PlanForm.test.tsx`

**Interfaces:**
- Consumes: `useField` (`@/ui/field.js`), `Input`/`Label` (`@/ui/shadcn/input.js`, `@/ui/shadcn/label.js`), `Reported` (`@/ui/Reported.js`) — all frozen, unmodified.
- Produces: nothing new — `PlanForm`'s exported signature (no export change) stays `export function PlanForm()`. A new file-local helper `feedEstimatePreviewText(rawValue: string): string` is not exported and is not consumed by any other task.

This task converts the three plain-text/number/date fields (`baselineDate`, `leisureAllowanceMinutes`, `feedEstimateMinutes`) from hand-wired `useId()` + raw `<input>` to `useField` + shadcn `Input`/`Label`, replaces the retired `--color-*` custom properties on this component with the new tokens, and makes the blank-feed-estimate invariant ("unknown is not zero") visible at the point of entry with a live `<Reported>` preview — not just describable in the help text, as it is today. It leaves `TimezoneConfirm` (select + checkbox) and the duration radios untouched; those move to shadcn primitives in Task 21. **Do not** touch `PlanForm`'s existing `validate`, `buildBody`, `submit`, or any of the nine existing `PlanForm.test.tsx` cases — all nine must keep passing unmodified, since none of their assertions depend on the DOM shape being changed here (label text, field-error text, and `aria-describedby` id-matching are unaffected: `getByLabelText`/`getByText` do not care whether the underlying element is a raw `<input>` or a shadcn `Input`, which is a raw `<input>` under a thin wrapper).

- [ ] **Step 1: Write the failing test**

Add this test to `apps/web/src/features/setup/PlanForm.test.tsx`, immediately after the existing test named `'400 fieldErrors render beside the named field'` (the last test in the `describe('PlanForm', ...)` block, just before its closing `})`):

```tsx
  it('shows the blank feed estimate as Not reported, and a typed value as recorded', async () => {
    mount()

    const blank = screen.getByText('Not reported')
    expect(blank).toHaveAttribute('data-tier', 'absent')

    const feedInput = screen.getByLabelText('Current daily feed time (estimate)')
    fireEvent.change(feedInput, { target: { value: '0' } })

    const recorded = await screen.findByText('0 min/day')
    expect(recorded).toHaveAttribute('data-tier', 'recorded')
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument()
  })
```

No new imports are needed for this test — `screen` and `fireEvent` are already imported at the top of the file, and `mount()` is the file's existing zero-argument helper that renders `PlanForm` at `/setup`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- PlanForm.test.tsx`
Expected: FAIL — `TestingLibraryElementError: Unable to find an element with the text: Not reported.` `PlanForm` currently renders only the static help paragraph `"leave blank if you do not know"`; there is no `<Reported>`-tiered preview of the field's value anywhere in the tree yet.

- [ ] **Step 3: Implement**

`PlanForm.tsx` already imports `api`, `newIdempotencyKey`, `queryKeys` and `Button` (its current lines
6-9) — do not re-add any of those four; re-listing an already-imported identifier is a TypeScript
duplicate-identifier compile error. Add only these four genuinely new lines, directly after the
existing `import { Button } from '../../ui/Button.js'` line:

```tsx
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { Reported } from '../../ui/Reported.js'
```

Add the preview helper directly above `export function PlanForm()`:

```tsx
/** "Unknown is not zero" made visible at the point of entry: a blank field
 * previews as the same `Not reported` string `absenceTier` recognizes as
 * the "not a value" tier; any typed number, including `0`, is a measurement
 * and previews in the `recorded` tier. */
function feedEstimatePreviewText(rawValue: string): string {
  const trimmed = rawValue.trim()
  return trimmed === '' ? 'Not reported' : `${trimmed} min/day`
}
```

Inside `PlanForm()`, replace the seven `useId()` lines:

```tsx
  const dateId = useId()
  const dateErrorId = useId()
  const leisureId = useId()
  const leisureErrorId = useId()
  const feedId = useId()
  const feedHelpId = useId()
  const feedErrorId = useId()
```

with:

```tsx
  const dateField = useField({ name: 'baselineDate', error: fieldErrors.baselineDate })
  const leisureField = useField({ name: 'leisureAllowanceMinutes', error: fieldErrors.leisureAllowanceMinutes })
  const feedField = useField({
    name: 'feedEstimateMinutes',
    description: 'leave blank if you do not know',
    error: fieldErrors.feedEstimateMinutes,
  })
```

(`useId` stays imported from `react` — `TimezoneConfirm`, later in this same file, still calls it directly until Task 21.)

Replace the baseline-date block:

```tsx
      <div className="flex flex-col gap-2">
        <label htmlFor={dateId} className="text-sm font-medium">
          Baseline date (Day 0)
        </label>
        <input
          id={dateId}
          type="date"
          value={baselineDate}
          onChange={(event) => {
            setBaselineDate(event.target.value)
          }}
          aria-invalid={fieldErrors.baselineDate !== undefined ? true : undefined}
          aria-describedby={fieldErrors.baselineDate !== undefined ? dateErrorId : undefined}
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        {fieldErrors.baselineDate !== undefined ? (
          <p id={dateErrorId} role="alert" className="text-sm">
            {fieldErrors.baselineDate}
          </p>
        ) : null}
      </div>
```

with:

```tsx
      <div className="flex flex-col gap-2">
        <Label {...dateField.labelProps}>Baseline date (Day 0)</Label>
        <Input
          type="date"
          value={baselineDate}
          onChange={(event) => {
            setBaselineDate(event.target.value)
          }}
          {...dateField.controlProps}
        />
        {dateField.errorProps !== undefined ? (
          <p {...dateField.errorProps} className="text-sm text-attention">
            {fieldErrors.baselineDate}
          </p>
        ) : null}
      </div>
```

Replace the leisure-allowance block:

```tsx
      <div className="flex flex-col gap-2">
        <label htmlFor={leisureId} className="text-sm font-medium">
          Leisure allowance (minutes)
        </label>
        <input
          id={leisureId}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={leisureAllowanceMinutes}
          onChange={(event) => {
            setLeisureAllowanceMinutes(event.target.value)
          }}
          aria-invalid={fieldErrors.leisureAllowanceMinutes !== undefined ? true : undefined}
          aria-describedby={fieldErrors.leisureAllowanceMinutes !== undefined ? leisureErrorId : undefined}
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        {fieldErrors.leisureAllowanceMinutes !== undefined ? (
          <p id={leisureErrorId} role="alert" className="text-sm">
            {fieldErrors.leisureAllowanceMinutes}
          </p>
        ) : null}
      </div>
```

with:

```tsx
      <div className="flex flex-col gap-2">
        <Label {...leisureField.labelProps}>Leisure allowance (minutes)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={leisureAllowanceMinutes}
          onChange={(event) => {
            setLeisureAllowanceMinutes(event.target.value)
          }}
          {...leisureField.controlProps}
        />
        {leisureField.errorProps !== undefined ? (
          <p {...leisureField.errorProps} className="text-sm text-attention">
            {fieldErrors.leisureAllowanceMinutes}
          </p>
        ) : null}
      </div>
```

Replace the feed-estimate block:

```tsx
      <div className="flex flex-col gap-2">
        <label htmlFor={feedId} className="text-sm font-medium">
          Current daily feed time (estimate)
        </label>
        <input
          id={feedId}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={feedEstimateMinutes}
          onChange={(event) => {
            setFeedEstimateMinutes(event.target.value)
          }}
          aria-invalid={fieldErrors.feedEstimateMinutes !== undefined ? true : undefined}
          aria-describedby={
            [feedHelpId, fieldErrors.feedEstimateMinutes !== undefined ? feedErrorId : undefined]
              .filter((id): id is string => id !== undefined)
              .join(' ') || undefined
          }
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        <p id={feedHelpId} className="text-sm text-[var(--color-text-muted)]">
          leave blank if you do not know
        </p>
        {fieldErrors.feedEstimateMinutes !== undefined ? (
          <p id={feedErrorId} role="alert" className="text-sm">
            {fieldErrors.feedEstimateMinutes}
          </p>
        ) : null}
      </div>
```

with:

```tsx
      <div className="flex flex-col gap-2">
        <Label {...feedField.labelProps}>Current daily feed time (estimate)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={feedEstimateMinutes}
          onChange={(event) => {
            setFeedEstimateMinutes(event.target.value)
          }}
          {...feedField.controlProps}
        />
        {feedField.descriptionProps !== undefined ? (
          <p {...feedField.descriptionProps} className="text-sm text-ink-muted">
            leave blank if you do not know
          </p>
        ) : null}
        <Reported className="text-sm">{feedEstimatePreviewText(feedEstimateMinutes)}</Reported>
        {feedField.errorProps !== undefined ? (
          <p {...feedField.errorProps} className="text-sm text-attention">
            {fieldErrors.feedEstimateMinutes}
          </p>
        ) : null}
      </div>
```

Finally, convert the one remaining `--color-text-muted` reference in this file's own JSX (the intro paragraph, not `TimezoneConfirm`'s):

```tsx
        <p className="text-sm text-[var(--color-text-muted)]">
          This saves a draft — nothing starts running yet.
        </p>
```

becomes:

```tsx
        <p className="text-sm text-ink-muted">
          This saves a draft — nothing starts running yet.
        </p>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- PlanForm.test.tsx`
Expected: PASS — all 10 tests (the original 9 plus the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/setup/PlanForm.tsx apps/web/src/features/setup/PlanForm.test.tsx
git commit -m "$(cat <<'EOF'
Wire PlanForm's plain fields through useField and make blank-feed-estimate visible

Convert baselineDate/leisureAllowanceMinutes/feedEstimateMinutes to shadcn
Input+Label wired through useField, replacing hand-rolled useId/aria-*
plumbing. The feed estimate now previews through Reported so a blank field
reads as "Not reported" (absent tier) and a typed value, including 0,
reads as recorded — the unknown-is-not-zero invariant made visible at the
point of entry, not just described in the help text. Converts this file's
remaining --color-text-muted reference to the ink-muted token.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 21: PlanForm — Timezone Select, Confirm Checkbox, and Duration RadioGroup

**Files:**
- Modify: `apps/web/src/features/setup/PlanForm.tsx`
- Test: `apps/web/src/features/setup/PlanForm.test.tsx`

**Interfaces:**
- Consumes: `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` (`@/ui/shadcn/select.js`), `Checkbox` (`@/ui/shadcn/checkbox.js`), `RadioGroup`/`RadioGroupItem` (`@/ui/shadcn/radio-group.js`); `useField`, `Label` from Task 20 (same file).
- Produces: nothing new — `TimezoneConfirm`'s props (`TimezoneConfirmProps`) are unchanged; this is an internal-markup-only change.

This task converts the native `<select>` + checkbox inside `TimezoneConfirm`, and the native radio inputs for practice-block duration, to their shadcn equivalents. It is the one genuine interaction-pattern change in this unit: a native `<select>` already carries an implicit ARIA `combobox` role (confirmed against this repo's pinned `aria-query@5.3.0` — `getByRole('combobox', { name: 'Timezone' })` already resolves today), but jsdom's `HTMLOptionElement` implements no click-activation behavour at all (confirmed against `node_modules/jsdom/lib/jsdom/living/nodes/HTMLOptionElement-impl.js`, and `@testing-library/user-event`'s click machinery has no special case for `<option>` either) — only `userEvent.selectOptions()` can change a native select's value in this test environment. So the existing test's `user.selectOptions(...)` call must become a click-based interaction (open the trigger, click the option), which is the interaction Radix's `Select` actually needs — and that is what turns Step 2 genuinely red.

The `Checkbox` and `RadioGroup` conversions do **not** require any test changes: Radix implements real `role="checkbox"`/`role="radio"` elements associated the same way via `<label htmlFor>`, so `getByLabelText('Confirm timezone')` and `getByRole('radio', { name: '5 minutes' })` keep resolving to the same accessible names without modification.

- [ ] **Step 1: Write the failing test**

First, add this jsdom-gap stub block to the top of `apps/web/src/features/setup/PlanForm.test.tsx`, right after the existing imports and before `afterEach(() => { cleanup() })`:

```tsx
// jsdom implements no click-activation behavior on <option> at all (this
// file's own reason for moving off `selectOptions` below), and once the
// timezone control becomes a Radix Select it needs the same jsdom-gap
// stubs `DemoControls.test.tsx` already documents and relies on:
// `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` (Select's
// trigger calls these on pointerdown) and `scrollIntoView` (SelectContent
// calls it while positioning the open list). Plain functions, not
// `vi.fn()`, so `setup.ts`'s global `afterEach(() => vi.resetAllMocks())`
// never wipes them.
if (typeof window.HTMLElement.prototype.hasPointerCapture !== 'function') {
  window.HTMLElement.prototype.hasPointerCapture = () => false
}
if (typeof window.HTMLElement.prototype.setPointerCapture !== 'function') {
  window.HTMLElement.prototype.setPointerCapture = () => {}
}
if (typeof window.HTMLElement.prototype.releasePointerCapture !== 'function') {
  window.HTMLElement.prototype.releasePointerCapture = () => {}
}
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}
```

Then, inside the test named `'blocks save until timezone is confirmed and sends the confirmed value'`, replace:

```tsx
    await fillBaseline(user, { confirm: false })
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York')
    await user.click(screen.getByRole('button', { name: 'Save' }))
```

with:

```tsx
    await fillBaseline(user, { confirm: false })
    await user.click(screen.getByRole('combobox', { name: 'Timezone' }))
    await user.click(await screen.findByRole('option', { name: 'America/New_York' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- PlanForm.test.tsx`
Expected: FAIL on `'blocks save until timezone is confirmed and sends the confirmed value'` — the query for `getByRole('combobox', { name: 'Timezone' })` still resolves (a native `<select>` already carries that implicit role) and the option click succeeds too, but the click on a plain `<option>` never sets the underlying `<select>`'s value in jsdom, so the final assertion `expect(body.timezone).toBe('America/New_York')` fails: `body.timezone` is still whatever `detectTimezone()` returned, not `'America/New_York'`.

- [ ] **Step 3: Implement**

Add the new imports (after the imports added in Task 20):

```tsx
import { Checkbox } from '../../ui/shadcn/checkbox.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/shadcn/select.js'
```

Change the `react` import — `useId` is no longer called anywhere in this file once `TimezoneConfirm` stops using it below:

```tsx
import { useId, useRef, useState, type FormEvent } from 'react'
```

becomes:

```tsx
import { useRef, useState, type FormEvent } from 'react'
```

Replace the entire `TimezoneConfirm` function body:

```tsx
function TimezoneConfirm({ value, confirmed, onChange, onConfirm, zones, error }: TimezoneConfirmProps) {
  const selectId = useId()
  const checkboxId = useId()
  const errorId = useId()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="text-sm font-medium">
        Timezone
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            onConfirm(event.target.checked)
          }}
        />
        Confirm timezone
      </label>

      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

with:

```tsx
function TimezoneConfirm({ value, confirmed, onChange, onConfirm, zones, error }: TimezoneConfirmProps) {
  const timezoneField = useField({ name: 'timezone', error })
  const confirmField = useField({ name: 'confirmTimezone' })

  return (
    <div className="flex flex-col gap-2">
      <Label {...timezoneField.labelProps}>Timezone</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger {...timezoneField.controlProps} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {zones.map((zone) => (
            <SelectItem key={zone} value={zone}>
              {zone}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(checked) => {
            onConfirm(checked === true)
          }}
          {...confirmField.controlProps}
        />
        <Label {...confirmField.labelProps}>Confirm timezone</Label>
      </div>

      {timezoneField.errorProps !== undefined ? (
        <p {...timezoneField.errorProps} className="text-sm text-attention">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

Replace the duration fieldset:

```tsx
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Practice block duration</legend>
        <div className="flex gap-4">
          {DURATION_OPTIONS.map((option) => (
            <label key={option.minutes} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="duration"
                value={option.minutes}
                checked={durationMinutes === option.minutes}
                onChange={() => {
                  setDurationMinutes(option.minutes)
                }}
              />
              {option.minutes} minutes
            </label>
          ))}
        </div>
      </fieldset>
```

with:

```tsx
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Practice block duration</legend>
        <RadioGroup
          className="flex gap-4"
          value={String(durationMinutes)}
          onValueChange={(next) => {
            setDurationMinutes(Number(next) as 5 | 10 | 15)
          }}
        >
          {DURATION_OPTIONS.map((option) => {
            const itemId = `duration-${option.minutes}`
            return (
              <div key={option.minutes} className="flex items-center gap-2 text-sm">
                <RadioGroupItem id={itemId} value={String(option.minutes)} />
                <Label htmlFor={itemId}>{option.minutes} minutes</Label>
              </div>
            )
          })}
        </RadioGroup>
      </fieldset>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- PlanForm.test.tsx`
Expected: PASS — all 10 tests, including the rewritten `'blocks save until timezone is confirmed and sends the confirmed value'` and the unmodified `'400 fieldErrors render beside the named field'` (still resolves `getByLabelText('Timezone')` to the Select's trigger and checks its `aria-describedby` against the rendered error's id).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/setup/PlanForm.tsx apps/web/src/features/setup/PlanForm.test.tsx
git commit -m "$(cat <<'EOF'
Convert PlanForm's timezone select, confirm checkbox and duration radios to shadcn

TimezoneConfirm now renders a shadcn Select and Checkbox wired through
useField instead of a native <select>/<input type=checkbox> with manual
useId/aria-* plumbing; practice-block duration moves to shadcn
RadioGroup/RadioGroupItem. Updates the one test whose interaction pattern
genuinely changes (timezone selection: click + option, not
userEvent.selectOptions, since jsdom's <option> has no click-activation
behavior of its own) — every other accessible name, role and aria
attribute in this file is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 22: ReadinessForm — SlotRow inputs through `useField`, and an unboxed hairline structure

**Files:**
- Modify: `apps/web/src/features/setup/ReadinessForm.tsx`
- Test: `apps/web/src/features/setup/ReadinessForm.test.tsx`

**Interfaces:**
- Consumes: `useField` (`@/ui/field.js`), `Input`/`Label` (`@/ui/shadcn/input.js`, `@/ui/shadcn/label.js`) — all frozen, unmodified.
- Produces: nothing new — `SlotRowProps`, `MissingSlotsProps`, and `ReadinessForm`'s exported signature are unchanged.

`SlotRow`'s five fields (`materialRef`, `language`, `deviceFormat`, `materialLevel`, `plannedLocalTime`) move from raw `<input>`/`<label htmlFor>` pairs to shadcn `Input`/`Label` wired through `useField`. Because a shadcn `Input` is a real native `<input>` under a thin styled wrapper, this alone changes no observable contract: `getByLabelText`, `toBeDisabled()` (native `fieldset[disabled]` cascades to any real `<input>` descendant regardless of the wrapper around it), and `getByRole('group', { name })` (the `<fieldset>`/`<legend>` pairing this form already uses) all keep resolving exactly as before, so none of this file's 9 existing tests need to change.

That refactor alone would have no meaningful new test — the existing suite is the correct regression guard for it, per this plan's own rule against inventing assertions with nothing new to check. But `useField`'s `description` wiring does fix a real, narrow gap this file has today: `FROZEN_EXPLANATION` currently renders as a plain, unassociated `<p>` next to a frozen row's disabled fields — nothing in the DOM tells an assistive-technology user *why* "Material reference" is disabled. This task wires that explanation as `materialRef`'s field description (only when the row is frozen), which is the one genuinely new, testable behavior here. It also removes the boxed `rounded-md border` treatment from each slot's `<fieldset>` and from `MissingSlots` — `Card` is reserved for genuinely raised surfaces elsewhere in this rework, and a bordered box around every form section is exactly the "wrapper by default" pattern this system rejects in favor of one hairline per section boundary — and converts every remaining `var(--color-border)`/`var(--color-text-muted)` reference in this file to the new tokens.

- [ ] **Step 1: Write the failing test**

Add this test to `apps/web/src/features/setup/ReadinessForm.test.tsx`, immediately after the existing test named `'frozen slot renders read-only with the frozen explanation'`:

```tsx
  it('frozen slot associates the frozen explanation with material reference via aria-describedby', async () => {
    const current = makeCurrent(makeProgram({ status: 'active' }), [
      makeSlot('baseline', 'A', {
        materialRef: 'Ref A',
        plannedLocalTime: '09:00',
        frozenAt: '2026-09-06T09:00:00.000Z',
      }),
      makeSlot('baseline', 'B'),
      makeSlot('final', 'A'),
      makeSlot('final', 'B'),
    ])
    mount(current)

    const group = await screen.findByRole('group', { name: 'Baseline A' })
    const input = within(group).getByLabelText('Material reference')
    const explanation = within(group).getByText('This slot is frozen because it already has an attempt.')

    expect(input).toHaveAttribute('aria-describedby', explanation.id)
  })
```

No new imports are needed — `within`, `screen`, `makeCurrent`, `makeProgram`, `makeSlot` and `mount` are already used by the neighbouring test this is copied from.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- ReadinessForm.test.tsx`
Expected: FAIL — `expect(input).toHaveAttribute('aria-describedby', ...)` fails because the current `materialRef` `<input>` has no `aria-describedby` attribute at all; `FROZEN_EXPLANATION` is rendered as a sibling `<p>` with no `id` and nothing points at it.

- [ ] **Step 3: Implement**

`ReadinessForm.tsx` already imports `api`, `queryKeys` and `Button` (its current lines 36-38) — do not
re-add any of those three; re-listing an already-imported identifier is a TypeScript
duplicate-identifier compile error. Add only these three genuinely new lines, directly after the
existing `import { Button } from '../../ui/Button.js'` line:

```tsx
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
```

Replace the entire `SlotRow` function body:

```tsx
export function SlotRow({ slot, frozen, value, onChange }: SlotRowProps) {
  const idBase = `readiness-${slot.key.replace(':', '-')}`

  return (
    <fieldset
      disabled={frozen}
      data-slot-key={slot.key}
      className="mb-6 rounded-md border border-[var(--color-border)] p-4"
    >
      <legend className="px-1 text-base font-semibold">{slot.title}</legend>

      {frozen ? <p className="mb-2 text-sm text-[var(--color-text-muted)]">{FROZEN_EXPLANATION}</p> : null}

      <div className="grid gap-3">
        <div>
          <label htmlFor={`${idBase}-materialRef`}>Material reference</label>
          <input
            id={`${idBase}-materialRef`}
            type="text"
            value={value.materialRef}
            onChange={(event) => onChange('materialRef', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-language`}>Language (optional)</label>
          <input
            id={`${idBase}-language`}
            type="text"
            value={value.language}
            onChange={(event) => onChange('language', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-deviceFormat`}>Device format (optional)</label>
          <input
            id={`${idBase}-deviceFormat`}
            type="text"
            value={value.deviceFormat}
            onChange={(event) => onChange('deviceFormat', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-materialLevel`}>Material level (optional)</label>
          <input
            id={`${idBase}-materialLevel`}
            type="text"
            value={value.materialLevel}
            onChange={(event) => onChange('materialLevel', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-plannedLocalTime`}>{slot.title} planned time</label>
          <input
            id={`${idBase}-plannedLocalTime`}
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            value={value.plannedLocalTime}
            onChange={(event) => onChange('plannedLocalTime', event.target.value)}
            className="mt-1 w-32 rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>
      </div>
    </fieldset>
  )
}
```

with:

```tsx
export function SlotRow({ slot, frozen, value, onChange }: SlotRowProps) {
  const idBase = `readiness-${slot.key.replace(':', '-')}`
  const materialRefField = useField({
    name: `${idBase}-materialRef`,
    description: frozen ? FROZEN_EXPLANATION : undefined,
  })
  const languageField = useField({ name: `${idBase}-language` })
  const deviceFormatField = useField({ name: `${idBase}-deviceFormat` })
  const materialLevelField = useField({ name: `${idBase}-materialLevel` })
  const plannedLocalTimeField = useField({ name: `${idBase}-plannedLocalTime` })

  return (
    <fieldset disabled={frozen} data-slot-key={slot.key} className="flex flex-col gap-3 py-6 first:pt-0">
      <legend className="text-base font-semibold">{slot.title}</legend>

      <div className="grid gap-3">
        <div className="flex flex-col gap-1">
          <Label {...materialRefField.labelProps}>Material reference</Label>
          <Input
            type="text"
            value={value.materialRef}
            onChange={(event) => onChange('materialRef', event.target.value)}
            {...materialRefField.controlProps}
          />
          {materialRefField.descriptionProps !== undefined ? (
            <p {...materialRefField.descriptionProps} className="text-sm text-ink-muted">
              {FROZEN_EXPLANATION}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label {...languageField.labelProps}>Language (optional)</Label>
          <Input
            type="text"
            value={value.language}
            onChange={(event) => onChange('language', event.target.value)}
            {...languageField.controlProps}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label {...deviceFormatField.labelProps}>Device format (optional)</Label>
          <Input
            type="text"
            value={value.deviceFormat}
            onChange={(event) => onChange('deviceFormat', event.target.value)}
            {...deviceFormatField.controlProps}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label {...materialLevelField.labelProps}>Material level (optional)</Label>
          <Input
            type="text"
            value={value.materialLevel}
            onChange={(event) => onChange('materialLevel', event.target.value)}
            {...materialLevelField.controlProps}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label {...plannedLocalTimeField.labelProps}>{slot.title} planned time</Label>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            value={value.plannedLocalTime}
            onChange={(event) => onChange('plannedLocalTime', event.target.value)}
            className="w-32"
            {...plannedLocalTimeField.controlProps}
          />
        </div>
      </div>
    </fieldset>
  )
}
```

Replace the `MissingSlots` body:

```tsx
export function MissingSlots({ missing }: MissingSlotsProps) {
  if (missing.length === 0) {
    return null
  }

  return (
    <div className="mb-6 rounded-md border border-[var(--color-border)] p-4">
      <p>Still needed before this program is ready:</p>
      <ul aria-label="Missing slots">
        {missing.map((key) => (
          <li key={key}>{SLOT_TITLES[key]}</li>
        ))}
      </ul>
    </div>
  )
}
```

with:

```tsx
export function MissingSlots({ missing }: MissingSlotsProps) {
  if (missing.length === 0) {
    return null
  }

  return (
    <div className="mb-6 border-l-2 border-attention py-1 pl-4">
      <p className="text-sm text-attention">Still needed before this program is ready:</p>
      <ul aria-label="Missing slots" className="text-sm text-ink">
        {missing.map((key) => (
          <li key={key}>{SLOT_TITLES[key]}</li>
        ))}
      </ul>
    </div>
  )
}
```

Finally, in `ReadinessForm` itself, wrap the mapped `SlotRow`s in a `divide-y` container so the hairline moved off each fieldset's own border still separates one slot from the next, and mark the status/alert copy in the `attention` token:

```tsx
      {notice !== null ? <p role="status">{notice}</p> : null}
      {oneHourMessage !== null ? <p role="alert">{oneHourMessage}</p> : null}
      {fieldErrors !== null ? (
        <ul role="alert">
          {Object.entries(fieldErrors).map(([field, value]) => (
            <li key={field}>{formatFieldError(value)}</li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit}>
        {SLOT_DEFS.map((def) => (
          <SlotRow
            key={def.key}
            slot={def}
            frozen={frozenKeys.has(def.key)}
            value={rows[def.key]}
            onChange={(field, value) => handleFieldChange(def, field, value)}
          />
        ))}

        <MissingSlots missing={missing} />
```

becomes:

```tsx
      {notice !== null ? (
        <p role="status" className="text-sm text-attention">
          {notice}
        </p>
      ) : null}
      {oneHourMessage !== null ? (
        <p role="alert" className="text-sm text-attention">
          {oneHourMessage}
        </p>
      ) : null}
      {fieldErrors !== null ? (
        <ul role="alert" className="text-sm text-attention">
          {Object.entries(fieldErrors).map(([field, value]) => (
            <li key={field}>{formatFieldError(value)}</li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="divide-y divide-rule">
          {SLOT_DEFS.map((def) => (
            <SlotRow
              key={def.key}
              slot={def}
              frozen={frozenKeys.has(def.key)}
              value={rows[def.key]}
              onChange={(field, value) => handleFieldChange(def, field, value)}
            />
          ))}
        </div>

        <MissingSlots missing={missing} />
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- ReadinessForm.test.tsx`
Expected: PASS — all 10 tests (the original 9, unmodified, plus the new `aria-describedby` test). In particular, confirm two neighbouring tests still pass unchanged even though this step moved where `FROZEN_EXPLANATION` lives in the DOM: `'frozen slot renders read-only with the frozen explanation'` queries `within(group).getByText('This slot is frozen because it already has an attempt.')` and `within(group).getByLabelText(...).toBeDisabled()` — both keep resolving, since the string only moved from a legend-adjacent `<p>` to `materialRef`'s own field-description `<p>`, still inside the same group, with its exact text and the fieldset's native `disabled` cascade untouched. `'server 409 frozen renders the same explanation and keeps the form'` queries a different element entirely — the top-level `<p role="status">{notice}</p>` this task does not touch — so it is unaffected by the SlotRow change.

Then run the full unit once more to catch any cross-file regression:
Run: `npm run test -w @attention-lab/web -- setup`
Expected: PASS — every test in `apps/web/src/features/setup/` (`PlanForm.test.tsx` and `ReadinessForm.test.tsx`) green.

Also do a real visual check for the purely-visual part of this task (the boxed-fieldset-to-hairline change has no accessible-tree signature, so no test can cover it): run `npm run dev:web` (with `npm run dev:api` running alongside, per this repo's normal local-demo setup) and open `/setup/readiness`. Look for: no rectangular border boxes around Baseline A/B or Final A/B, a single thin hairline between each pair of adjacent slot sections (none above the first, none below the last), and a thin amber left-rule (not a boxed border) on the "Still needed before this program is ready" notice whenever a required field is left blank.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/setup/ReadinessForm.tsx apps/web/src/features/setup/ReadinessForm.test.tsx
git commit -m "$(cat <<'EOF'
Wire ReadinessForm's SlotRow inputs through useField and drop boxed fieldsets

SlotRow's five fields move to shadcn Input+Label via useField in place of
hand-built ids and raw <input>s; a frozen row's explanation is now the
materialRef field's aria-describedby target instead of an unassociated
sibling paragraph, fixing a real screen-reader gap the old markup left in
place. Replaces each slot's boxed rounded-border fieldset and the
MissingSlots box with a divide-y hairline between slots and a thin
amber-rule notice — Card stays reserved for genuinely raised surfaces
elsewhere in this rework, not a default form wrapper. Converts every
remaining --color-border/--color-text-muted reference in this file to the
rule/ink-muted/attention tokens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Benchmark: ready and running

### Task 23: Retire `--color-*` tokens and the decorative amber border from Ready and Running

**Files:**
- Modify: `apps/web/src/features/benchmark/Ready.tsx`
- Modify: `apps/web/src/features/benchmark/Running.tsx`
- Test: `apps/web/src/features/benchmark/Ready.test.tsx`

**Interfaces:**
- Consumes: nothing new. `Button` (`../../ui/Button.js`), `ActiveSessionCard` (`../session/ActiveSessionCard.js`), `TimerDisplay`/`EventButtons`/`SyncStatus`/`Tallies` (`../focus/*.js`) keep their existing import paths and prop shapes.
- Produces: nothing — leaf task. `Checklist`, `ReplacementReasonField`, `Ready`, `Running` keep their exact current exported names and prop signatures; only `className` strings change.

`--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary` and `--color-primary-text` no longer exist once Wave 0 lands (index.css now defines `paper`/`card`/`rule`/`ink`/`ink-muted`/`signal`/`attention` as Tailwind utilities). Both files in this unit still reference the old names across twelve class attributes (Ready.tsx has eight, at lines 103, 124, 133, 135, 311, 314, 316 and 322; Running.tsx has four, at lines 172, 173, 202 and 203 — line 133 alone carries three separate `--color-*` tokens in one `className`, so fourteen token references total), and both wrap their whole screen in `border-t-4 border-t-amber-500` — a permanent decorative border in the `attention` amber, which the design reserves strictly for "needs-you and uncertainty," never a static screen accent for "this is a benchmark."

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `apps/web/src/features/benchmark/Ready.test.tsx`, plus the two node-built-in imports it needs at the top of the file:

```tsx
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
```

(the existing `afterEach, describe, expect, it` import from `'vitest'` gains the two new imports above it; nothing else in the existing import block changes).

Then, after the closing `})` of the existing `describe('Ready', ...)` block, add:

```tsx
describe('token conversion', () => {
  it('Ready.tsx and Running.tsx use no legacy --color-* token and no decorative amber class', () => {
    const readyPath = fileURLToPath(new URL('./Ready.tsx', import.meta.url))
    const runningPath = fileURLToPath(new URL('./Running.tsx', import.meta.url))
    const readySource = readFileSync(readyPath, 'utf8')
    const runningSource = readFileSync(runningPath, 'utf8')

    for (const source of [readySource, runningSource]) {
      expect(source).not.toMatch(/--color-(bg|surface|border|text|primary|focus-ring)/)
      expect(source).not.toMatch(/amber-/)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- Ready`
Expected: FAIL — `expect(received).not.toMatch(expected)` on the first `source` (Ready.tsx), because its text still contains `text-[var(--color-text)]` (line 103's `Checklist` class), which matches `/--color-(bg|surface|border|text|primary|focus-ring)/`.

- [ ] **Step 3: Implement**

`apps/web/src/features/benchmark/Ready.tsx` — nine one-line class changes:

```tsx
// Checklist
- <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text)]">
+ <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
```

```tsx
// ReplacementReasonField label
- <label htmlFor="replacement-reason" className="block text-sm font-medium text-[var(--color-text)]">
+ <label htmlFor="replacement-reason" className="block text-sm font-medium text-ink">
```

```tsx
// ReplacementReasonField textarea
-        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
+        className="w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink"
```

```tsx
// ReplacementReasonField counter
- <p className="text-xs text-[var(--color-text-muted)]">
+ <p className="text-xs text-ink-muted">
```

```tsx
// Ready's outer container — drop the decorative amber border entirely
- <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6 border-t-4 border-t-amber-500">
+ <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6">
```

```tsx
// header h1
-        <h1 className="text-lg font-semibold text-[var(--color-text)]">
+        <h1 className="text-lg font-semibold text-ink">
```

```tsx
// header materialRef paragraph
-        <p className="text-sm text-[var(--color-text)]">{slot.materialRef}</p>
+        <p className="text-sm text-ink">{slot.materialRef}</p>
```

```tsx
// header planned-time paragraph
-          <p className="text-sm text-[var(--color-text-muted)]">{`Planned time: ${slot.plannedLocalTime}`}</p>
+          <p className="text-sm text-ink-muted">{`Planned time: ${slot.plannedLocalTime}`}</p>
```

```tsx
// LEAVING_NOTE paragraph
-      <p className="text-sm text-[var(--color-text-muted)]">{LEAVING_NOTE}</p>
+      <p className="text-sm text-ink-muted">{LEAVING_NOTE}</p>
```

`apps/web/src/features/benchmark/Running.tsx` — five one-line class changes:

```tsx
// outer container — drop the decorative amber border entirely
- <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6 border-t-4 border-t-amber-500">
+ <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6">
```

```tsx
// header h1
-        <h1 className="text-lg font-semibold text-[var(--color-text)]">Fixed 20-minute assessment</h1>
+        <h1 className="text-lg font-semibold text-ink">Fixed 20-minute assessment</h1>
```

```tsx
// header LEAVING_NOTE paragraph
-        <p className="text-sm text-[var(--color-text-muted)]">{LEAVING_NOTE}</p>
+        <p className="text-sm text-ink-muted">{LEAVING_NOTE}</p>
```

```tsx
// inline stop-early confirm group — role/aria-label untouched, class only
-            <div role="group" aria-label="Confirm stop early" className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
+            <div role="group" aria-label="Confirm stop early" className="flex flex-col gap-2 rounded-md border border-rule p-3">
```

```tsx
// inline stop-early confirm group's message
-              <p className="text-sm text-[var(--color-text)]">This attempt will be recorded as incomplete.</p>
+              <p className="text-sm text-ink">This attempt will be recorded as incomplete.</p>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- Ready Running`
Expected: PASS — the new `token conversion` test passes, and every pre-existing `Ready` and `Running` test still passes unmodified (no accessible name, role, or `data-testid` changed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/Ready.tsx apps/web/src/features/benchmark/Running.tsx apps/web/src/features/benchmark/Ready.test.tsx
git commit -m "$(cat <<'EOF'
Retire legacy --color-* tokens from Benchmark Ready/Running

Both screens still referenced the pre-rework CSS custom properties across
twelve class attributes and wrapped themselves in a permanent amber top border —
decorative use of the attention token, which the new palette reserves for
needs-you and uncertainty only. Converts every reference to the new
paper/card/rule/ink/ink-muted tokens and drops the border. A grep-based
regression test pins both files to zero remaining legacy references.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 24: Ready — static ink 20:00 face, and an accessible replacement-reason field

**Files:**
- Modify: `apps/web/src/features/benchmark/Ready.tsx`
- Test: `apps/web/src/features/benchmark/Ready.test.tsx`

**Interfaces:**
- Consumes:
  - `useField(options: UseFieldOptions): FieldWiring` from `../../ui/field.js` (frozen)
  - `Label` from `../../ui/shadcn/label.js` (frozen, focus-visible classes already stripped)
  - `Textarea` from `../../ui/shadcn/textarea.js` (frozen, focus-visible classes already stripped)
  - `formatRemaining(totalSeconds: number): string` from `../../lib/clock/remaining.js` (existing, pure, already used by `TimerDisplay`)
- Produces: nothing new exported. `ReplacementReasonFieldProps` (`value`, `onChange`, `required`) is unchanged — only the function body changes.

Two defects this task fixes, both named directly in the frozen design: (1) Ready has no visible "20:00" anywhere — the design requires the fixed duration to render in ink, not mono, in the same visual position `Running` gives its live countdown, so the two screens read as one instrument face in two states; (2) `ReplacementReasonField`'s character counter (`0/500`) is not wired to the textarea via `aria-describedby` — one of the five named sites in the design's defect list ("the recall points, disruption note, review note, replacement reason and output note"). This task runs after Task 23, so the "before" snippets below already show `text-ink`/`text-ink-muted`/`border-rule`/`bg-card`.

- [ ] **Step 1: Write the failing test**

Add these two tests inside the existing `describe('Ready', ...)` block in `apps/web/src/features/benchmark/Ready.test.tsx`, alongside the other `it(...)` cases (no new imports needed — `screen`, `renderReady`, `makeSlot`, `SlotAttemptValue` are already in scope):

```tsx
  it('shows the fixed 20:00 duration in ink before the session starts, not mono', async () => {
    renderReady(makeSlot())

    await screen.findByRole('button', { name: 'Start' })
    const duration = screen.getByTestId('benchmark-fixed-duration')
    expect(duration).toHaveTextContent('20:00')
    expect(duration.className).toMatch(/\btext-ink\b/)
    expect(duration.className).not.toMatch(/font-mono/)
  })

  it('replacement reason counter is associated with the textarea via aria-describedby', async () => {
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'prior-1', lifecycle: 'finalized', eligible: false, excludedByAmendment: false },
    ]
    const { user } = renderReady(makeSlot({ attempts }))

    const textarea = await screen.findByLabelText('Reason for replacement')
    const describedById = textarea.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(document.getElementById(describedById as string)).toHaveTextContent('0/500')

    await user.type(textarea, 'Fire alarm')
    expect(document.getElementById(describedById as string)).toHaveTextContent('10/500')
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- Ready`
Expected: FAIL — the first new test fails with "Unable to find an element by: [data-testid=\"benchmark-fixed-duration\"]" (nothing renders "20:00" today); the second fails with `expect(describedById).toBeTruthy()` receiving `null`, because the raw `<textarea>` carries no `aria-describedby`.

- [ ] **Step 3: Implement**

Four new import lines and one new constant — everything else in `Ready.tsx`'s current import block and
constant block stays exactly where it is; do not retype the existing lines.

Insert one new line, `import { formatRemaining } from '../../lib/clock/remaining.js'`, directly after
the existing `import { api } from '../../lib/api/client.js'` line and before the existing
`import { queryKeys } from '../../lib/query/keys.js'` line.

Insert three new lines directly after the existing `import { Button } from '../../ui/Button.js'` line
and before the existing `import { ActiveSessionCard } from '../session/ActiveSessionCard.js'` line:

```tsx
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
```

Insert one new constant line, `const FIXED_DURATION_SECONDS = 1200`, directly after the existing
`const MAX_REASON_LENGTH = 500` line.

The resulting import and constant block (shown here only so the placement above is unambiguous — do
not paste this whole block over the existing one, since six of these ten import lines and two of these
three constant lines already exist unchanged):

```tsx
import { api } from '../../lib/api/client.js'
import { formatRemaining } from '../../lib/clock/remaining.js'
import { queryKeys } from '../../lib/query/keys.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { useStartSession } from '../../lib/query/useStartSession.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'

const LEAVING_NOTE = 'Leaving this page to read does not count as distraction.'
const MAX_REASON_LENGTH = 500
const FIXED_DURATION_SECONDS = 1200
```

Replace `ReplacementReasonField` entirely:

```tsx
export function ReplacementReasonField({ value, onChange, required }: ReplacementReasonFieldProps) {
  const field = useField({
    name: 'replacement-reason',
    description: `${value.length}/${MAX_REASON_LENGTH}`,
    required,
  })

  return (
    <div className="space-y-1">
      <Label {...field.labelProps} className="block text-sm font-medium text-ink">
        Reason for replacement
      </Label>
      <Textarea
        {...field.controlProps}
        value={value}
        maxLength={MAX_REASON_LENGTH}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.descriptionProps ? (
        <p {...field.descriptionProps} className="text-xs text-ink-muted">
          {value.length}/{MAX_REASON_LENGTH}
        </p>
      ) : null}
    </div>
  )
}
```

Insert the static duration face between the header and the checklist, in `Ready`'s own return:

```tsx
      </header>

      <p className="text-4xl text-ink" data-testid="benchmark-fixed-duration">
        {formatRemaining(FIXED_DURATION_SECONDS)}
      </p>

      <Checklist items={PROTOCOL_CHECKLIST_ITEMS} />
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- Ready`
Expected: PASS — the two new tests pass, and every pre-existing test in the file still passes, including `'prior ineligible attempt from slot.attempts requires a reason before Start enables and sends replacementReason'` (still finds the field by `getByLabelText('Reason for replacement')` and still enables Start once text is typed) and `'no navigation landmarks are rendered'` (`expectNoIdentifiers` sees no UUID or realm word in "20:00").

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/Ready.tsx apps/web/src/features/benchmark/Ready.test.tsx
git commit -m "$(cat <<'EOF'
Ready: show the fixed 20:00 duration in ink, wire the reason field's counter

The protocol sheet had no visible duration at all; adds a static, non-mono
"20:00" in ink in the same slot Running gives its live countdown, so the
two screens read as one instrument face before and during measurement.
Also rewires ReplacementReasonField onto the frozen Field contract and the
generated shadcn Label/Textarea, fixing the character counter's missing
aria-describedby — one of the five sites the design's defect list names.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 25: Running — render the live countdown in petrol

**Files:**
- Modify: `apps/web/src/features/benchmark/Running.tsx`
- Test: `apps/web/src/features/benchmark/Running.test.tsx`

**Interfaces:**
- Consumes: `TimerDisplay` from `../focus/TimerDisplay.js` (existing import, unchanged props: `remainingSeconds`, optional `hidden`/`onToggleHidden`).
- Produces: nothing new exported — `Running`'s props and every existing `data-testid`/role stay exactly where they are (`timer-digits` is `TimerDisplay`'s own testid, untouched).

This is the one line in the whole unit the design calls out by name (§8, "Benchmark: ready and running"): "Running replaces that constant with a live petrol countdown. That colour change is what distinguishes a benchmark from a variable-length practice block — not a decorative marker." `TimerDisplay`'s digits (`<p className="text-4xl font-mono tabular-nums" data-testid="timer-digits">`) carry no explicit text color today, so they inherit whatever color their ancestor sets. Wrapping the mount site in a `text-signal` container turns the digits petrol without touching `TimerDisplay.tsx` itself (owned by the Focus unit) — the "Hide timer" button beside it keeps its own `Button`-supplied `text-ink`, since `Button` sets that class explicitly and an inherited ancestor color never overrides an element's own explicit class.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('Running', ...)` block in `apps/web/src/features/benchmark/Running.test.tsx`, next to the other cases (`mountReady`, `benchmarkSession` and `screen` are already in scope in this file):

```tsx
  it('the live countdown renders inside a petrol (text-signal) wrapper', async () => {
    await mountReady({ session: benchmarkSession({ id: 'session-petrol' }) })

    const digits = screen.getByTestId('timer-digits')
    expect(digits.closest('.text-signal')).not.toBeNull()
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- Running`
Expected: FAIL — `expect(digits.closest('.text-signal')).not.toBeNull()` receives `null`, because no ancestor of the timer digits carries a `text-signal` class today.

- [ ] **Step 3: Implement**

```tsx
// before
      <TimerDisplay remainingSeconds={remainingSeconds} />

// after
      <div className="text-signal">
        <TimerDisplay remainingSeconds={remainingSeconds} />
      </div>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- Running`
Expected: PASS — the new test passes, and every pre-existing `Running` test still passes: `timer-digits`' text content, the deadline-reached branch, the stop-early flow, and the stale-conflict branch are all unaffected, since the wrapper adds no attributes `TimerDisplay` itself relies on and the stale-conflict early return never reaches this line at all.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/Running.tsx apps/web/src/features/benchmark/Running.test.tsx
git commit -m "$(cat <<'EOF'
Running: render the live benchmark countdown in petrol

Wraps the mount site of the shared TimerDisplay in text-signal so the
ticking digits inherit the petrol color while Running is active, without
touching TimerDisplay.tsx itself (owned by the Focus unit). This is the
one visual difference the design names explicitly as what distinguishes a
fixed benchmark interval from a variable-length practice block — Ready's
static "20:00" (Task 24) stays plain ink until a session actually starts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Benchmark: recall and scoring

### Task 26: Recall's point fields — shadcn Textarea/Field wiring and the shared point-shell container

**Files:**
- Modify: `apps/web/src/features/benchmark/Recall.tsx`
- Test: `apps/web/src/features/benchmark/Recall.test.tsx`

**Interfaces:**
- Consumes: `useField(options: UseFieldOptions): FieldWiring` (`@/ui/field.js`); `Label` (`@/ui/shadcn/label.js`); `Textarea` (`@/ui/shadcn/textarea.js`)
- Produces: `export const POINT_SHELL_CLASSNAME: string` from `Recall.tsx` — task 22 imports this into `Scoring.tsx` so the blank textarea, the locked sentence and the scored-blank row share one literal container shape.

This closes design defect #2 (recall-point counters have no `aria-describedby`) and starts the "same container shape across blank textarea, locked sentence, and scored point" requirement by giving the blank-textarea state its shell first.

- [ ] **Step 1: Write the failing tests**

First, replace the existing import line in `Recall.test.tsx`:

```tsx
import { Recall } from './Recall.js'
```

with:

```tsx
import { Recall, POINT_SHELL_CLASSNAME } from './Recall.js'
```

Then add these two `it` blocks inside `describe('Recall', ...)`:

```tsx
  it('each recall point textarea is described by its own character counter (aria-describedby)', async () => {
    respond('sessions.get', makeSession())

    const { user } = renderRecall()
    await waitForConfirmStep()
    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')

    const firstPoint = screen.getByLabelText('Point 1')
    const describedBy = firstPoint.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const counter = describedBy === null ? null : document.getElementById(describedBy)
    expect(counter).not.toBeNull()
    expect(counter).toHaveTextContent('0/500')

    await user.type(firstPoint, 'ab')
    expect(counter).toHaveTextContent('2/500')
  })

  it('every recall point sits inside the shared point-shell container exported for Scoring to reuse', async () => {
    respond('sessions.get', makeSession())

    const { user, container } = renderRecall()
    await waitForConfirmStep()
    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')

    const shells = container.querySelectorAll('[data-point-shell="true"]')
    expect(shells).toHaveLength(5)
    for (const shell of Array.from(shells)) {
      expect(shell.className).toBe(POINT_SHELL_CLASSNAME)
    }
  })
```

- [ ] **Step 2: Run it and watch it fail**

Both new cases arrive in the same edit as the import change above, so they fail together, not separately: Vitest has to load a module before it can decide which tests inside it match a `-t` pattern, and the import now names an export `Recall.tsx` does not have yet.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx`
Expected: FAIL for the whole file — the 11 pre-existing, otherwise-still-correct cases included — with `SyntaxError: The requested module './Recall.js' does not provide an export named 'POINT_SHELL_CLASSNAME'`. No `-t` filter changes this; the module fails to load before any filter is applied. That single failure stands in for both new tests' real assertions, which Step 4 confirms once Step 3 supplies the export: the point-shell case would still fail on `expect(shells).toHaveLength(5)` (`expected 0 to be 5`, since nothing renders a `data-point-shell` marker yet), and the aria-describedby case would still fail on `expect(describedBy).toBeTruthy()` (today's counter `<p>` carries no `id`, so `aria-describedby` has nothing to point at).

- [ ] **Step 3: Implement**

Before (imports and the `RecallPoints` block):
```tsx
import { api } from '../../lib/api/client.js'
import { newIdempotencyKey } from '../../lib/api/newIdempotencyKey.js'
import { serverNowMs, type ClockAnchor } from '../../lib/clock/remaining.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { TimerDisplay } from '../focus/TimerDisplay.js'

const RECALL_TARGET_SECONDS = 180
const MAX_POINT_LENGTH = 500
const BLANK_POINTS: readonly [string, string, string, string, string] = ['', '', '', '', '']

type Phase = 'confirm' | 'writing'

// ---------------------------------------------------------------------------
// RecallPoints
// ---------------------------------------------------------------------------

export interface RecallPointsProps {
  readonly values: readonly [string, string, string, string, string]
  readonly onChange: (index: number, value: string) => void
  readonly disabled: boolean
}

/** Five blank-allowed textareas, "Point 1".."Point 5" — blank is a valid, sent value, never coerced to anything else. */
export function RecallPoints({ values, onChange, disabled }: RecallPointsProps) {
  return (
    <div className="space-y-4">
      {values.map((value, index) => {
        const id = `recall-point-${index + 1}`
        return (
          <div key={id} className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)]">
              Point {index + 1}
            </label>
            <textarea
              id={id}
              value={value}
              maxLength={MAX_POINT_LENGTH}
              rows={2}
              disabled={disabled}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-70"
              onChange={(event) => onChange(index, event.target.value)}
            />
            <p className="text-xs text-[var(--color-text-muted)]">
              {value.length}/{MAX_POINT_LENGTH}
            </p>
          </div>
        )
      })}
    </div>
  )
}
```

After:
```tsx
import { api } from '../../lib/api/client.js'
import { newIdempotencyKey } from '../../lib/api/newIdempotencyKey.js'
import { serverNowMs, type ClockAnchor } from '../../lib/clock/remaining.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
import { TimerDisplay } from '../focus/TimerDisplay.js'

const RECALL_TARGET_SECONDS = 180
const MAX_POINT_LENGTH = 500
const BLANK_POINTS: readonly [string, string, string, string, string] = ['', '', '', '', '']

type Phase = 'confirm' | 'writing'

// ---------------------------------------------------------------------------
// RecallPoints
// ---------------------------------------------------------------------------

export interface RecallPointsProps {
  readonly values: readonly [string, string, string, string, string]
  readonly onChange: (index: number, value: string) => void
  readonly disabled: boolean
}

/**
 * Shared with Scoring.tsx's `PointRow`: the blank textarea here, the locked
 * sentence there, and the scored-blank row there must all sit inside this
 * exact shape, so the eye tracks continuity across the recall -> scoring
 * transition instead of a page reset (the rework spec §8, "Benchmark: recall and
 * scoring"). `data-point-shell="true"` is a new, non-preserved-contract
 * marker used only so tests can confirm the shape actually matches.
 */
export const POINT_SHELL_CLASSNAME = 'space-y-2 rounded-md border border-rule px-4 py-3'

interface RecallPointFieldProps {
  readonly index: number
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (index: number, value: string) => void
}

function RecallPointField({ index, value, disabled, onChange }: RecallPointFieldProps) {
  // `description` only needs to be present (any truthy string) to make
  // `useField` allocate a `descriptionProps` id — the actual counter text is
  // still ours to render. This is what wires the counter's `aria-describedby`
  // that defect #2 in the rework spec §9 flags as missing today.
  const field = useField({ name: `recall-point-${index + 1}`, description: 'character count' })
  return (
    <div className={POINT_SHELL_CLASSNAME} data-point-shell="true">
      <Label {...field.labelProps} className="text-sm font-medium text-ink">
        Point {index + 1}
      </Label>
      <Textarea
        {...field.controlProps}
        value={value}
        maxLength={MAX_POINT_LENGTH}
        rows={2}
        disabled={disabled}
        onChange={(event) => onChange(index, event.target.value)}
      />
      <p {...field.descriptionProps} className="text-xs text-ink-muted">
        {value.length}/{MAX_POINT_LENGTH}
      </p>
    </div>
  )
}

/** Five blank-allowed textareas, "Point 1".."Point 5" — blank is a valid, sent value, never coerced to anything else. */
export function RecallPoints({ values, onChange, disabled }: RecallPointsProps) {
  return (
    <div className="space-y-4">
      {values.map((value, index) => (
        <RecallPointField key={index} index={index} value={value} disabled={disabled} onChange={onChange} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx`
Expected: PASS — all existing Recall cases plus the two new ones (13 total).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/benchmark/Recall.tsx apps/web/src/features/benchmark/Recall.test.tsx
git commit -m "$(cat <<'EOF'
Wire Recall's point fields onto shadcn Textarea/Field with a shared shell

Fixes the recall-point character counter's missing aria-describedby (a
pre-existing defect fixed en route by the shadcn rework) and introduces
POINT_SHELL_CLASSNAME so the blank textarea, the locked sentence and the
scored-blank row (Scoring.tsx, next commit) share one container shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 27: Recall's chrome — token conversion, the incomplete-attempt marker, and a calm "Time is up"

**Files:**
- Modify: `apps/web/src/features/benchmark/Recall.tsx`
- Test: `apps/web/src/features/benchmark/Recall.test.tsx`

**Interfaces:**
- Consumes: `Badge` (`@/ui/shadcn/badge.js`); the frozen `Button` (`@/ui/Button.js`, unchanged call sites)
- Produces: nothing further — this closes out every remaining `var(--color-*)` reference in `Recall.tsx`.

Converts the four remaining old-token references outside `RecallPoints` (task 20 already handled the ones inside it): the `<h1>`, the "Incomplete attempt" marker, the "Time is up" notice, and the retry row. "Time is up — save when you are ready" must read as calm, not urgent — it is explicitly required to never take the amber `attention` treatment, since overrun is a server-side flag, not a live warning the client is raising.

The "Incomplete attempt" marker is also a pre-existing mis-tiering worth naming while it's touched: today it renders in the same muted grey the app uses for absent values (`text-[var(--color-text-muted)]`), even though `completeInterval === false` is a recorded fact about this session (D25), not an unreported one. A shadcn `Badge` is a fine container for that fact, but the fact itself is the **recorded** tier — ink — never the muted "not reported" tier and never amber (the rework spec §3, "Colour": "Recorded data is ink, not a colour... A saved measurement gets no green badge; it is simply written down."). The implementation below forces that with an explicit `className="text-ink"` on the `Badge`, since its own default "outline" variant text colour is `text-foreground`, not literally `text-ink`, and the test below asserts on that explicit class rather than on the `Badge` component's own internal markup.

- [ ] **Step 1: Write the failing test**

Add inside `describe('Recall', ...)`:

```tsx
  it('incomplete attempt renders as a recorded fact — ink, never amber or muted-gap styling', async () => {
    respond('sessions.get', makeSession({ completeInterval: false }))

    renderRecall()
    await waitForConfirmStep()

    const badge = screen.getByText('Incomplete attempt')
    expect(badge.className).toContain('text-ink')
    expect(badge.className).not.toContain('text-ink-muted')
    expect(badge.className).not.toMatch(/text-attention/)
  })

  it('the calm "Time is up" notice renders in the muted ink tier, never the attention/amber treatment', async () => {
    const clock = stubMonotonicClock()
    respond('sessions.get', makeSession())

    const { user } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')
    clock.advanceSeconds(181)
    await user.type(screen.getByLabelText('Point 1'), 'x')

    const notice = await screen.findByText('Time is up — save when you are ready')
    expect(notice.className).toContain('text-ink-muted')
    expect(notice.className).not.toMatch(/text-attention/)
  })

  it('no leftover --color-* custom property reference remains in the rendered recall screen', async () => {
    respond('sessions.get', makeSession())

    const { user, container } = renderRecall()
    await waitForConfirmStep()
    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')

    expect(container.innerHTML).not.toMatch(/var\(--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx -t "recorded fact"`
Expected: FAIL at `expect(badge.className).toContain('text-ink')` — today's pill is `inline-block rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]`, which has no `text-ink` substring at all.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx -t "muted ink tier"`
Expected: FAIL at `expect(notice.className).toContain('text-ink-muted')` — today's `<p role="status">Time is up — save when you are ready</p>` carries no `className` at all, so `notice.className` is `''`.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx -t "leftover"`
Expected: FAIL — `container.innerHTML` still contains `var(--color-text)` from the `<h1>` and the retry row.

- [ ] **Step 3: Implement**

Add the import:
```tsx
import { Badge } from '../../ui/shadcn/badge.js'
```

Before (the render, from the `<h1>` through the end of the component):
```tsx
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Recall</h1>

      {phase === 'confirm' ? (
        <div className="space-y-4">
          {session.completeInterval === false ? (
            <p className="inline-block rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
              Incomplete attempt
            </p>
          ) : null}
          <p>Is your reading material closed?</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleStartRecall}>Start recall</Button>
            {showSkip ? (
              <Button variant="secondary" onClick={handleSkipRecall}>
                Skip recall
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <TimerDisplay remainingSeconds={remainingSeconds} />
          {timeIsUp ? <p role="status">Time is up — save when you are ready</p> : null}

          <RecallPoints values={points} disabled={false} onChange={handlePointChange} />

          <div className="space-y-2">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              Save recall
            </Button>
            {showRetryRow ? (
              <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-text)]">
                <p>The recall could not be saved. Retry.</p>
                <Button variant="secondary" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
```

After:
```tsx
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-ink">Recall</h1>

      {phase === 'confirm' ? (
        <div className="space-y-4">
          {session.completeInterval === false ? (
            // A recorded fact about this session (D25), not a live warning —
            // ink, per "Recorded data is ink, not a colour" (the rework spec §3).
            // variant="outline" is just a plain bordered container;
            // className="text-ink" overrides Badge's default text-foreground
            // so this never reads as the muted "not reported" tier or the
            // amber "uncertain" one.
            <Badge variant="outline" className="text-ink">
              Incomplete attempt
            </Badge>
          ) : null}
          <p>Is your reading material closed?</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleStartRecall}>Start recall</Button>
            {showSkip ? (
              <Button variant="secondary" onClick={handleSkipRecall}>
                Skip recall
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <TimerDisplay remainingSeconds={remainingSeconds} />
          {timeIsUp ? (
            <p role="status" className="text-sm text-ink-muted">
              Time is up — save when you are ready
            </p>
          ) : null}

          <RecallPoints values={points} disabled={false} onChange={handlePointChange} />

          <div className="space-y-2">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              Save recall
            </Button>
            {showRetryRow ? (
              <div role="status" className="flex items-center gap-3 text-sm text-ink">
                <p>The recall could not be saved. Retry.</p>
                <Button variant="secondary" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx`
Expected: PASS — all 16 cases (11 original + 2 from task 20 + 3 from this task).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/benchmark/Recall.tsx apps/web/src/features/benchmark/Recall.test.tsx
git commit -m "$(cat <<'EOF'
Convert Recall's chrome to the new tokens and a calm Time-is-up notice

Incomplete attempt now renders through shadcn's Badge, explicitly in ink
rather than the muted grey the old hand-rolled pill used — it is a
recorded fact about the session (D25), never colour-coded, per design.md's
"Recorded data is ink, not a colour" rule. The deadline notice explicitly
never takes the amber attention treatment, since overrun is a
server-derived flag, not a live client warning. No accessible name or role
changes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 28: Scoring's `PointRow` — shadcn RadioGroup, the shared point-shell, and the ink/not-a-value split

**Files:**
- Modify: `apps/web/src/features/benchmark/Scoring.tsx`
- Test: `apps/web/src/features/benchmark/Scoring.test.tsx`

**Interfaces:**
- Consumes: `POINT_SHELL_CLASSNAME` (produced by task 20, `./Recall.js`); `Label` (`@/ui/shadcn/label.js`); `RadioGroup`, `RadioGroupItem` (`@/ui/shadcn/radio-group.js`)
- Produces: nothing further — task 23 edits a different region of this same file (the mode banners and the preview/flags block), never `PointRow`.

Replaces the direct `radix-ui` `RadioGroup` import with the generated shadcn primitive, gives every point row (blank or scored) `POINT_SHELL_CLASSNAME` so it matches the textarea shape from task 20, and splits "Scored 0 because blank" into the two spans the unit brief requires: the `0` is a real derived score and stays in ink, the explanatory clause takes the not-a-value (`ink-muted`) treatment. Radio ids (`point-${index}-accurate` / `point-${index}-not-accurate`) are kept byte-identical — `Scoring.test.tsx`'s "Tab order reaches every radio in point order" case hard-codes them.

Splitting one text node into two `<span>` elements has a consequence worth calling out: Testing Library's default text matchers (`getByText`/`getAllByText`) read only an element's own *direct* text-node children, never a descendant's — so an exact-string query for `'Scored 0 because blank'` cannot match anything once that phrase is drawn by two nested spans (neither span's own text is the full phrase, and the wrapping `<p>`'s own direct children are the two `<span>` elements, not text). The pre-existing "points 1–3 Accurate…" test below already runs exactly that query, so it needs a one-line update alongside `PointRow`'s change, or it silently breaks.

- [ ] **Step 1: Write the failing tests**

First, add `within` to the existing `@testing-library/react` import — replace:
```tsx
import { cleanup, screen } from '@testing-library/react'
```
with:
```tsx
import { cleanup, screen, within } from '@testing-library/react'
```

Then add a new import line directly after the existing `import { PointRow, Scoring } from './Scoring.js'` line — `Recall.tsx` and `Scoring.tsx` are sibling files in the same directory, so the specifier is `./Recall.js`, not `../Recall.js`:
```tsx
import { POINT_SHELL_CLASSNAME } from './Recall.js'
```

Next, update the one line in the pre-existing "points 1–3 Accurate…" test that the span split above breaks. Change:
```tsx
    expect(screen.getByText('Recall score (self-reported, preview): 3/5')).toBeInTheDocument()
    expect(screen.getAllByText('Scored 0 because blank')).toHaveLength(2)
    expect(screen.getAllByRole('radio')).toHaveLength(6)
```
to:
```tsx
    expect(screen.getByText('Recall score (self-reported, preview): 3/5')).toBeInTheDocument()
    expect(screen.getAllByText('Scored 0')).toHaveLength(2)
    expect(screen.getAllByText('because blank')).toHaveLength(2)
    expect(screen.getAllByRole('radio')).toHaveLength(6)
```

Finally, add these two `it` blocks inside `describe('Scoring', ...)`:

```tsx
  it('locked point rows sit inside the same point-shell container as Recall\'s textareas', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS })

    const { container } = renderScoring(session, review)

    const shells = container.querySelectorAll('[data-point-shell="true"]')
    expect(shells).toHaveLength(5)
    for (const shell of Array.from(shells)) {
      expect(shell.className).toBe(POINT_SHELL_CLASSNAME)
    }
  })

  it('a blank point splits "Scored 0" (ink) from "because blank" (not-a-value) into two spans', () => {
    const points: [string, string, string, string, string] = ['p1', 'p2', 'p3', '', '']
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: points })

    const { container } = renderScoring(session, review)

    const shells = Array.from(container.querySelectorAll('[data-point-shell="true"]'))
    const blankShells = shells.filter((shell) => shell.textContent?.includes('because blank'))
    expect(blankShells).toHaveLength(2)

    for (const shell of blankShells) {
      const zero = within(shell).getByText('Scored 0')
      const clause = within(shell).getByText('because blank')
      expect(zero.tagName).toBe('SPAN')
      expect(zero.className).toContain('text-ink')
      expect(zero.className).not.toContain('text-ink-muted')
      expect(clause.tagName).toBe('SPAN')
      expect(clause.className).toContain('text-ink-muted')
    }
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "point-shell"`
Expected: FAIL with `expected 0 to be 5` — `PointRow` renders no `data-point-shell` marker yet.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "splits"`
Expected: FAIL with `expected 0 to be 2` — same cause as above: no `data-point-shell` marker exists yet, so `blankShells` is empty before it can even look for the two spans inside it.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "no radios for the blanks"`
Expected: FAIL — `Unable to find an element with the text: Scored 0`. This is the pre-existing test after its one-line update above: today the whole phrase is still one `<p>` text node, so an exact query for just `'Scored 0'` matches nothing yet.

- [ ] **Step 3: Implement**

Before:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { RadioGroup } from 'radix-ui'
import { Link } from 'react-router'
import type { RecallFlag, ReviewInputValue, ReviewResponseValue, SessionResponseValue } from '@attention-lab/shared'
```
```tsx
export function PointRow({ index, text, value, onChange }: PointRowProps) {
  const label = `Point ${index + 1}`
  const isBlank = text.trim().length === 0

  if (isBlank) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        <p className="text-sm text-[var(--color-text-muted)]">Scored 0 because blank</p>
      </div>
    )
  }

  const accurateId = `point-${index}-accurate`
  const notAccurateId = `point-${index}-not-accurate`

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
      <p className="text-sm text-[var(--color-text)]">{text}</p>
      <fieldset>
        <legend className="sr-only">{`${label} score`}</legend>
        <RadioGroup.Root
          className="flex gap-4"
          required
          value={value ?? null}
          onValueChange={(next) => onChange(next as 'accurate' | 'not_accurate')}
        >
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id={accurateId}
              value="accurate"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor={accurateId} className="text-sm text-[var(--color-text)]">
              Accurate
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id={notAccurateId}
              value="not_accurate"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor={notAccurateId} className="text-sm text-[var(--color-text)]">
              Not accurate
            </label>
          </div>
        </RadioGroup.Root>
      </fieldset>
    </div>
  )
}
```

After:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { RecallFlag, ReviewInputValue, ReviewResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { Label } from '../../ui/shadcn/label.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'
import { POINT_SHELL_CLASSNAME } from './Recall.js'
```
```tsx
export function PointRow({ index, text, value, onChange }: PointRowProps) {
  const label = `Point ${index + 1}`
  const isBlank = text.trim().length === 0

  if (isBlank) {
    return (
      <div className={POINT_SHELL_CLASSNAME} data-point-shell="true">
        <p className="text-sm font-medium text-ink">{label}</p>
        {/* The 0 is a real derived score (ink); the explanation is the
            not-a-value clause (ink-muted) — two spans, deliberately not one
            <Reported>, since absenceTier only recognizes a closed set of
            exact absence strings and "because blank" is not one of them. */}
        <p className="text-sm">
          <span className="text-ink">Scored 0</span> <span className="text-ink-muted">because blank</span>
        </p>
      </div>
    )
  }

  const accurateId = `point-${index}-accurate`
  const notAccurateId = `point-${index}-not-accurate`

  return (
    <div className={POINT_SHELL_CLASSNAME} data-point-shell="true">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-sm text-ink">{text}</p>
      <fieldset>
        <legend className="sr-only">{`${label} score`}</legend>
        <RadioGroup
          className="flex gap-4"
          required
          value={value ?? undefined}
          onValueChange={(next) => onChange(next as 'accurate' | 'not_accurate')}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id={accurateId} value="accurate" />
            <Label htmlFor={accurateId} className="text-sm text-ink">
              Accurate
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={notAccurateId} value="not_accurate" />
            <Label htmlFor={notAccurateId} className="text-sm text-ink">
              Not accurate
            </Label>
          </div>
        </RadioGroup>
      </fieldset>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx`
Expected: PASS — all 10 original cases plus the 2 new ones. In particular "Tab order reaches every radio in point order" must still pass unmodified, proving the shadcn `RadioGroupItem` ids stayed byte-identical.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/benchmark/Scoring.tsx apps/web/src/features/benchmark/Scoring.test.tsx
git commit -m "$(cat <<'EOF'
Move Scoring's PointRow onto shadcn RadioGroup and the shared point-shell

PointRow now shares POINT_SHELL_CLASSNAME with Recall's textareas (task
20) so the container never changes shape across blank textarea, locked
sentence and scored point. "Scored 0 because blank" splits into two
spans — the 0 stays ink as a real derived score, the clause takes the
not-a-value tier. Radio ids are unchanged. Also updates the pre-existing
"points 1-3 Accurate" test's exact-phrase query, which the span split
would otherwise silently break (Testing Library's default text matcher
only reads an element's own direct text children).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 29: Scoring's mode banners, preview score and recall flags — tokens, and flags that are facts, not uncertainty

**Files:**
- Modify: `apps/web/src/features/benchmark/Scoring.tsx`
- Test: `apps/web/src/features/benchmark/Scoring.test.tsx`

**Interfaces:**
- Consumes: nothing new — pure token conversion in the `locked_required` / `recall_missing` banners, the preview-score line and the `recallFlags` list.
- Produces: nothing — leaf task.

Converts the last four `var(--color-*)` references in `Scoring.tsx`: the "Go to recall" link, the preview-score line, and the `recallFlags` list. `recall_delayed`/`recall_overrun` are precisely-known facts about the recall attempt (the interval elapsed, the flag either applies or it does not) — the unit brief is explicit that they must never take the amber `attention` token, which is reserved for genuine uncertainty (`Unknown`, `Timing uncertain`).

- [ ] **Step 1: Write the failing test**

Add inside `describe('Scoring', ...)`:

```tsx
  it('the recall-first link uses the signal token, never a bare CSS variable', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: null })

    renderScoring(session, review)

    const link = screen.getByRole('link', { name: /recall/i })
    expect(link.className).toContain('text-signal')
    expect(link.className).not.toMatch(/var\(--color-/)
  })

  it('the preview score line renders in ink, not the muted tier', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS })

    renderScoring(session, review)

    const scoreLine = screen.getByText('Recall score (self-reported, preview): 0/5')
    expect(scoreLine.className).toContain('text-ink')
    expect(scoreLine.className).not.toContain('text-ink-muted')
  })

  it('recall flags are rendered as known facts and never take the attention/amber token', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({
      recallLockedAt: LOCKED_AT,
      recallPoints: FIVE_POINTS,
      recallFlags: ['recall_delayed', 'recall_overrun'],
    })

    renderScoring(session, review)

    const list = screen.getByText(/Recall started more than 10 minutes/).closest('ul')
    expect(list).not.toBeNull()
    expect(list?.className).toContain('text-ink-muted')
    expect(list?.className).not.toMatch(/text-attention/)
  })

  it('no leftover --color-* custom property reference remains in the rendered scoring screen', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS, recallFlags: ['recall_delayed'] })

    const { container } = renderScoring(session, review)

    expect(container.innerHTML).not.toMatch(/var\(--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "signal token"`
Expected: FAIL at `expect(link.className).toContain('text-signal')` — `link.className` is `text-sm underline text-[var(--color-primary)]`, which has no `text-signal` substring (the second assertion, about the bare `var(--color-` reference, is never reached).

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "preview score line"`
Expected: FAIL at `expect(scoreLine.className).toContain('text-ink')` — the current className is `text-sm font-medium text-[var(--color-text)]`, which has no `text-ink` substring.

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx -t "leftover"`
Expected: FAIL — the preview line and the flags list still reference `var(--color-text)` / `var(--color-text-muted)`.

- [ ] **Step 3: Implement**

Before:
```tsx
  if (mode === 'locked_required') {
    return (
      <div className="space-y-2">
        <p>Recall must be saved first</p>
        <Link to={`/benchmark/${session.id}/recall`} className="text-sm underline text-[var(--color-primary)]">
          Go to recall
        </Link>
      </div>
    )
  }

  if (mode === 'recall_missing') {
    return (
      <div className="space-y-2">
        <p>Recall not saved — this attempt will be recorded with recall missing</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {POINT_INDICES.map((index) => (
          <PointRow
            key={index}
            index={index}
            text={points[index]}
            value={answers[index]}
            onChange={(value) => handleAnswerChange(index, value)}
          />
        ))}
      </div>

      <p className="text-sm font-medium text-[var(--color-text)]">
        Recall score (self-reported, preview): {previewScore}/5
      </p>

      {review.recallFlags.length > 0 ? (
        <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
          {review.recallFlags.map((flag) => (
            <li key={flag}>
              {FLAG_COPY[flag]} (noted, not excluding)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
```

After:
```tsx
  if (mode === 'locked_required') {
    return (
      <div className="space-y-2">
        <p>Recall must be saved first</p>
        <Link to={`/benchmark/${session.id}/recall`} className="text-sm underline text-signal">
          Go to recall
        </Link>
      </div>
    )
  }

  if (mode === 'recall_missing') {
    return (
      <div className="space-y-2">
        <p>Recall not saved — this attempt will be recorded with recall missing</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {POINT_INDICES.map((index) => (
          <PointRow
            key={index}
            index={index}
            text={points[index]}
            value={answers[index]}
            onChange={(value) => handleAnswerChange(index, value)}
          />
        ))}
      </div>

      <p className="text-sm font-medium text-ink">
        Recall score (self-reported, preview): {previewScore}/5
      </p>

      {review.recallFlags.length > 0 ? (
        // recall_delayed/recall_overrun are precisely-known facts about this
        // attempt, not uncertainty — ink-muted, never the amber attention
        // token that the taxonomy reserves for "Unknown"/"Timing uncertain".
        <ul className="space-y-1 text-sm text-ink-muted">
          {review.recallFlags.map((flag) => (
            <li key={flag}>
              {FLAG_COPY[flag]} (noted, not excluding)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Scoring.test.tsx`
Expected: PASS — all 12 prior cases (10 original + 2 from task 22) plus the 4 new ones, 16 total.

Then run the whole unit together:
Run: `npm run test -w @attention-lab/web -- src/features/benchmark/Recall.test.tsx src/features/benchmark/Scoring.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/benchmark/Scoring.tsx apps/web/src/features/benchmark/Scoring.test.tsx
git commit -m "$(cat <<'EOF'
Finish Scoring's token conversion; recall flags stay ink-muted, not amber

The recall-first link, the preview-score line and the recallFlags list
move off the removed --color-* variables. recall_delayed/recall_overrun
are precisely-known facts about the attempt, so they explicitly never
take the amber attention token reserved for genuine uncertainty.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Benchmark review and finalize

Scope note read before writing these tasks: `page.locator('#materially-disrupted-no')` is used directly
by CSS id in `e2e/benchmark-review.spec.ts:157,231` and `e2e/recovery.spec.ts:278,321`, and
`ReviewAttestation.test.tsx`'s keyboard-traversal test asserts the literal `id` attribute at every tab
stop except one. Neither the disruption radios nor `ConditionsFields`' text inputs/checkboxes change
their `id` values anywhere below. Only the two free-text counters (`disruption-note`, `review-note`) are
re-wired through `useField`, whose `inputId` generation is opaque from outside `apps/web/src/ui/field.ts`
— so every assertion touching those two controls is written against their accessible name or the live
`aria-describedby` attribute, never a hard-coded id string.

`ConditionsFields`' checkboxes stay native `<input type="checkbox">` (they carry no `--color-*`
reference today, so there is nothing to convert) rather than moving to the generated Radix-backed
`shadcn/checkbox` — five e2e specs (`benchmark-review`, `recovery`, `timing-deviation`,
`never-completed`, `support/benchmark.ts`) drive "These conditions are correct" with `.check()`, and
that control is not named in this unit's brief, so it is left alone rather than taking on an unforced
risk. `DisruptionField`'s `RadioGroup` stays the direct `radix-ui` import for the same reason: the ids
are pinned, and re-pointing it at the generated wrapper buys nothing this brief asks for.

That checkbox/radio-group exception does **not** extend to plain text inputs, textareas or their
labels. the rework spec §6 states the app-wide mechanism every form in the app is supposed to be built on:
"No shadcn/form, and no react-hook-form ... Instead: `Label` + `Input`/`Textarea`/`Select` plus one
small local `Field` component that owns id generation and wires `aria-describedby` and
`aria-invalid`" (decision U8) — a matched pair with `Field`, not an alternative to it. Every native
`<input type="text">`/`<textarea>` and its paired `<label>` in this unit's four files therefore moves
onto the generated `Input`/`Textarea`/`Label` primitives below: `CountFields.tsx`'s S/E fields, the
mind-wandering field and the first-switch-estimate field; `DisruptionField.tsx`'s note;
`ConditionsFields.tsx`'s three text fields (device format, language, material level — not its
checkboxes, covered above); and `Finalize.tsx`'s review note. `grep -rn` across `e2e/` for
`count-field-`, `mind-wandering-count`, `first-switch-estimate`, `conditions-device-format`,
`conditions-language` and `conditions-material-level` returns nothing, so those six ids carry no risk
either way. `review-note` is different: it IS matched twice in `e2e/` (`practice-review.spec.ts:294`,
`a11y/keyboard-review.spec.ts:448`), but both hits target `apps/web/src/features/review/
ReviewNoteField.tsx` — an unrelated practice-review-screen field that coincidentally shares the same
literal id string — never `Finalize.tsx`'s own field, which this unit alone owns (Task 33 below routes
it through `useField` instead of keeping the literal string, precisely because nothing here needs it
preserved). So swapping the underlying element for the generated primitive — which forwards `id`,
`value`, `onChange` and every other native prop unchanged — carries no risk to either suite for any of
these seven fields. `useField` is layered on top only where design.md's defect list (§9, item 2) actually
names a counter with no `aria-describedby`: `disruption-note` and `review-note`. It is not used for
`CountFields.tsx`'s or `ConditionsFields.tsx`'s fields, which have no counter to wire and keep their
existing hand-written ids exactly as they are today.

---

### Task 30: Fix `EligibilitySummary`'s collapsed-null defect and apply the value taxonomy to the finalized summary

**Files:**
- Modify: `apps/web/src/features/benchmark/EligibilitySummary.tsx`
- Test: `apps/web/src/features/benchmark/Finalize.test.tsx`

**Interfaces:**
- Consumes: `@/ui/Reported.js`'s `Reported({ children: string, mono?: boolean, className?: string })`,
  which renders `<span data-tier={tier}>` from `absenceTier(children)`.
- Produces: nothing — `EligibilitySummaryProps` and every exported name in this file are unchanged;
  later tasks in this unit do not import from it.

`EligibilitySummary` types `eligible` as `boolean | null` and today renders `null` exactly like
`false` — `{eligible === true ? 'Eligible' : 'Not eligible'}` — which collapses "not yet determined"
into a negative result. This is the same defect class the whole taxonomy exists to prevent, just
sitting in the eligibility column instead of a count. The fix also finishes converting this file's
four data rows onto the three-tier taxonomy, since `Reported` already exists as of Wave 0.

- [ ] **Step 1: Write the failing test**

Add this case to the existing `describe('FinalizeSection / FinalizeBar / EligibilitySummary', ...)`
block in `Finalize.test.tsx`, next to the existing `'blank S renders not reported...'` case (same
`makeFinalizeResult`/`makeReview`/`mockHook`/`renderSection` helpers already in this file — no new
imports needed):

```tsx
it('undetermined eligibility (eligible: null) renders Not reported under the absent tier, never Not eligible', () => {
  mockHook({
    status: 'success',
    result: makeFinalizeResult({
      eligible: null,
      exclusionReasons: [],
      review: makeReview({ episodeCount: 2, recallScore: 4, firstSwitch: { kind: 'known', seconds: 90 } }),
    }),
  })
  renderSection()

  // episodeCount/recallScore/firstSwitch are all given real values above so
  // exactly one "Not reported" renders on the page — the eligibility line —
  // and getByText stays unambiguous.
  const heading = screen.getByText('Not reported')
  expect(heading).toHaveAttribute('data-tier', 'absent')
  expect(screen.queryByText('Not eligible')).not.toBeInTheDocument()
  expect(screen.queryByText('Eligible')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- Finalize`
Expected: FAIL — the test's own first statement, `screen.getByText('Not reported')`, throws
(`Unable to find an element with the text: Not reported`) before any `expect()` runs. Today's
`EligibilitySummary` renders `<p>Not eligible</p>` for `eligible: null` and, with `episodeCount: 2`,
`recallScore: 4` and a known `firstSwitch` all supplied, none of the other three rows renders the
literal string "Not reported" either — so no element with that exact text exists anywhere on the page
yet.

- [ ] **Step 3: Implement**

Replace `EligibilitySummary.tsx` in full:

```tsx
/**
 * EligibilitySummary — the real, server-written result shown once a
 * benchmark review has finalized (task 8.4.5; design.md D4, D7.2, D25, D31;
 * specs/benchmark-assessment: "Eligibility is derived server-side with
 * explicit reasons"; specs/app-shell: "Copy never punishes or gamifies").
 * Mounted by `FinalizeSection` (this same file's sibling `Finalize.tsx`)
 * only once `useFinalizeSession(sessionId)`'s `status` reaches `'success'`
 * — this is the ONE place in the Scoring flow that renders a real
 * eligibility result rather than `EligibilityPreview`'s (8.4.4) always-a-
 * preview label, and it renders the finalize response's own
 * `eligible`/`exclusionReasons` verbatim (D4 — never a client re-derivation).
 *
 * Every reason renders through `packages/shared`'s own `EXCLUSION_REASON_COPY`
 * — the exact same map `EligibilityPreview` uses — so `recall_missing` and
 * `scoring_incomplete` can appear together for an incomplete attempt without
 * this component inventing its own wording. S (`review.episodeCount`) and
 * recall score (`review.recallScore`) each render "Not reported" for a
 * `null` value (D31: never `0` for blank), and the first-switch line reuses
 * `formatFirstSwitch` verbatim so "Unknown" and "20+, capped" stay the same
 * two disjoint strings they are everywhere else in this flow. Nothing here
 * computes or renders a percentage, a score-out-of framing beyond the plain
 * "n/5 (self-reported)" recall line, or any causal/celebratory wording — an
 * ineligible attempt is shown with the same neutral layout as an eligible
 * one (the "attempt still shown" requirement: exclusion reasons are additive
 * information, never a reason to hide the rest of the summary).
 *
 * shadcn-ui-rework (2026-09-09) fixed a real defect here: `eligible` is
 * `boolean | null` (a benchmark's `focus_sessions.eligible` column is
 * nullable end to end), and this component used to render `null` exactly
 * like `false` — `eligible === true ? 'Eligible' : 'Not eligible'` — which
 * silently turned "not yet determined" into a reported negative result, the
 * same failure class CLAUDE.md's "unknown != zero" exists to catch, just in
 * the eligibility column instead of a count. `eligibilityLabel` below gives
 * `null` its own string, and every data row (including this one) now routes
 * through `@/ui/Reported.js`'s `Reported`, so "Not reported" renders under
 * the absent tier (ink-muted, ruled) rather than reading like a plain
 * sentence, and a real "Eligible"/"Not eligible" outcome renders in ink
 * under the taxonomy's catch-all "recorded" tier — a determined result,
 * whichever way it went, is ink, never colour-coded good/bad.
 *
 * "Continue" (the one primary action here) refetches `GET /programs/current`
 * itself — rather than trusting whatever `nextAction` this component was
 * mounted with, which can be stale the instant finalize changes what the
 * server would compute next — and routes to `/benchmark/:slotId` for a
 * `benchmark` or `final` `nextAction`, else `/today`. The optional
 * `nextAction` prop exists only so a parent that already has a fresh value
 * (e.g. immediately after its own `GET /programs/current`) can pass it
 * through for context; the click handler never trusts it for the actual
 * routing decision.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  EXCLUSION_REASON_COPY,
  formatFirstSwitch,
  type ExclusionReason,
  type NextActionValue,
  type ReviewResponseValue,
  type SessionResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { Reported } from '../../ui/Reported.js'

export interface EligibilitySummaryProps {
  readonly session: SessionResponseValue
  readonly review: ReviewResponseValue
  readonly eligible: boolean | null
  readonly exclusionReasons: readonly ExclusionReason[]
  /** Context only — see the module comment on why Continue never routes off this value directly. */
  readonly nextAction?: NextActionValue | undefined
}

function formatEpisodeCount(value: number | null): string {
  return value === null ? 'Not reported' : String(value)
}

function formatRecallScore(value: number | null): string {
  return value === null ? 'Not reported' : `${value}/5 (self-reported)`
}

/**
 * `eligible: null` is a benchmark whose eligibility has genuinely not been
 * decided — never a synonym for `false`. It gets its own absent-tier string
 * rather than being folded into "Not eligible" (this file's fixed defect).
 */
function eligibilityLabel(eligible: boolean | null): string {
  if (eligible === true) {
    return 'Eligible'
  }
  if (eligible === false) {
    return 'Not eligible'
  }
  return 'Not reported'
}

export function EligibilitySummary({ session, review, eligible, exclusionReasons }: EligibilitySummaryProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [continuing, setContinuing] = useState(false)

  async function handleContinue(): Promise<void> {
    setContinuing(true)
    try {
      const fresh = await api.programs.current()
      queryClient.setQueryData(queryKeys.programs.current, fresh)
      if (fresh.nextAction.kind === 'benchmark' || fresh.nextAction.kind === 'final') {
        navigate(`/benchmark/${fresh.nextAction.slotId}`)
      } else {
        navigate('/today')
      }
    } finally {
      setContinuing(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="eligibility-summary">
      <p className="text-base font-semibold">
        <Reported>{eligibilityLabel(eligible)}</Reported>
      </p>

      {eligible !== true && exclusionReasons.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink-muted">
          {exclusionReasons.map((reason) => (
            <li key={reason}>{EXCLUSION_REASON_COPY[reason]}</li>
          ))}
        </ul>
      ) : null}

      <dl className="space-y-1 text-sm text-ink">
        <div>
          <dt className="inline text-ink-muted">Local date: </dt>
          <dd className="inline">{session.localDate}</dd>
        </div>
        <div>
          <dt className="inline text-ink-muted">Off-task episodes (S): </dt>
          <dd className="inline">
            <Reported>{formatEpisodeCount(review.episodeCount)}</Reported>
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-muted">Recall score: </dt>
          <dd className="inline">
            <Reported>{formatRecallScore(review.recallScore)}</Reported>
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-muted">First switch: </dt>
          <dd className="inline">
            <Reported>{review.firstSwitch === null ? 'Not reported' : formatFirstSwitch(review.firstSwitch)}</Reported>
          </dd>
        </div>
      </dl>

      <Button type="button" variant="primary" disabled={continuing} onClick={() => void handleContinue()}>
        Continue
      </Button>
    </div>
  )
}
```

Local date is never nullable at this point (a finalized session always has one), so it is left as
plain text rather than wrapped in `Reported`. The other three rows and the headline all route through
it, which resolves cleanly against every existing assertion: `screen.getByText('Eligible')`,
`.getByText('Not eligible')`, `within(sRow).getByText('3')`, `.getByText('4/5 (self-reported)')`,
`.getByText('1:30')` and `within(sRow).getByText('Not reported')` in `Finalize.test.tsx` each locate
an element whose *entire own text* is that string — `Reported` puts the string alone inside its
`<span>`, with no label text sharing that span — so none of those calls become ambiguous or empty.

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- Finalize`
Expected: PASS, including every pre-existing case in `Finalize.test.tsx` (`'Not eligible'`,
`'summary lists interval_incomplete...'`, `'timing_deviation reason rendered...'`, `'blank S renders
not reported...'`, `'summary contains no % text'`, `'Continue routes to...'`) — none of their
assertions needed to change.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/EligibilitySummary.tsx apps/web/src/features/benchmark/Finalize.test.tsx
git commit -m "$(cat <<'EOF'
Fix EligibilitySummary collapsing eligible:null into Not eligible

eligible is boolean | null end to end; null meant "not yet determined"
and rendered identically to a real negative result. Give it its own
"Not reported" string under the absent tier, and route every data row
in the summary through the new Reported taxonomy component.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 31: Make the four first-switch preview states visibly different in `CountFields`

**Files:**
- Modify: `apps/web/src/features/benchmark/CountFields.tsx`
- Test: `apps/web/src/features/benchmark/CountFields.test.tsx`

**Interfaces:**
- Consumes: `@/ui/Reported.js`'s `Reported({ children: string, mono?: boolean, className?: string })`;
  `Input` (`@/ui/shadcn/input.js`); `Label` (`@/ui/shadcn/label.js`).
- Produces: nothing — `CountFields`, `CountField`, `FirstSwitchPreview`, `CountFieldsValue` and
  `BLANK_COUNT_FIELDS_VALUE` keep their existing exported shapes; `BenchmarkReviewPage.tsx` (Task 33)
  and `CountFields.test.tsx` both import `FirstSwitchPreview` unchanged.

`FirstSwitchPreview` already computes four disjoint strings — `'20+, capped'`, `'Unknown'`, an
`'≈ N min (estimate)'` string and an `'M:SS (event)'` string — but renders them all the same way,
inside one `<p>` with no distinction. This wraps only the value (never the `"First switch, preview: "`
label) in `Reported`, so `'20+, capped'` and the estimate/event strings fall through
`absenceTier`'s catch-all into the `recorded` tier (ink) and `'Unknown'` hits its exact-match branch
into the `uncertain` tier (amber) — the visible split the design calls for. This also finishes the
`--color-*` -> token conversion for every control in this file, per the global constraint that those
custom properties no longer exist, and moves every native `<input>`/`<label>` in this file — the S/E
fields inside `CountField`, the mind-wandering field and the first-switch-estimate field — onto the
generated `Input`/`Label` primitives (the rework spec §6/U8's "Label + Input/Textarea/Select" pairing, see
this unit's scope note above). Each keeps its existing hand-written `id` exactly as it is today; none
of them is referenced by any e2e selector, and `Input`/`Label` forward every native prop (`value`,
`onChange`, `disabled`, `placeholder`, `aria-describedby`, `className`, ...) unchanged, so this is a
plain element swap with no behavioural change for any existing test.

Splitting the label and the value into a shared-parent text node and a nested `<span>` changes what a
DOM-text query sees: `getNodeText` (what Testing Library's `getByText` matches against) only
concatenates an element's *direct* text-node children, so `screen.getByText(/First switch, preview:
20\+, capped/)` — which used to match the `<p>` because both strings were direct text children of
it — stops matching once `'20+, capped'` moves into a child `<span>`. The four tests below are
rewritten to query the value's own span directly and assert its `data-tier`, which is also a strictly
stronger check of the actual requirement (visible difference) than the old substring match was.

- [ ] **Step 1: Write the failing test**

Replace these four existing `it` blocks in `CountFields.test.tsx` (same `describe('CountFields', ...)`
block, same `renderHarness`/`screen`/`readDebugValue` helpers already in the file):

```tsx
it('explicit 0 -> episodeCount 0 and preview 20+, capped, rendered recorded not absent', async () => {
  const session = makeSession({ events: [] })

  const { user } = renderHarness(session)

  await user.type(screen.getByLabelText('Off-task episodes (S)'), '0')

  expect(readDebugValue().episodeCount).toBe('0')
  const value = screen.getByText('20+, capped')
  expect(value).toHaveAttribute('data-tier', 'recorded')
  expect(value.closest('p')).toHaveTextContent('First switch, preview: 20+, capped')
})

it('retrospective 3 without estimate -> Unknown rendered uncertain, and no 20+ text anywhere', async () => {
  const session = makeSession({ events: [] })

  const { user } = renderHarness(session)

  await user.type(screen.getByLabelText('Off-task episodes (S)'), '3')

  expect(readDebugValue().countMethod).toBe('retrospective')
  const value = screen.getByText('Unknown')
  expect(value).toHaveAttribute('data-tier', 'uncertain')
  expect(value.closest('p')).toHaveTextContent('First switch, preview: Unknown')
  expect(screen.queryByText(/20\+/)).not.toBeInTheDocument()
})

it('estimate 6 -> ≈ 6 min (estimate) preview label, rendered recorded', async () => {
  const session = makeSession({ events: [] })

  const { user } = renderHarness(session)

  await user.type(screen.getByLabelText('Off-task episodes (S)'), '3')
  await user.type(screen.getByLabelText('Estimated minute of first switch'), '6')

  expect(readDebugValue().estimateMinutes).toBe('6')
  const value = screen.getByText('≈ 6 min (estimate)')
  expect(value).toHaveAttribute('data-tier', 'recorded')
})

it('first off_task event at 370000 ms -> 6:10 (event), rendered recorded', () => {
  const session = makeSession({
    events: [makeEvent({ clientEventId: 'e1', type: 'off_task', elapsedMs: 370_000 })],
  })

  renderHarness(session)

  const value = screen.getByText('6:10 (event)')
  expect(value).toHaveAttribute('data-tier', 'recorded')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- CountFields`
Expected: FAIL on all four rewritten cases — `screen.getByText('20+, capped')` (and the other three
exact-value queries) find nothing today, because the value is not yet its own DOM node; the current
markup only has `screen.getByText(/First switch, preview: .../)` matching the whole `<p>`.

- [ ] **Step 3: Implement**

After the existing `import { Button } from '../../ui/Button.js'` line, add:

```tsx
import { Reported } from '../../ui/Reported.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
```

Replace `FirstSwitchPreview`'s return and the `CountField`/mind-wandering/estimate markup's token
classes:

```tsx
export function FirstSwitchPreview({ firstSwitch, estimateMinutes }: FirstSwitchPreviewProps) {
  if (firstSwitch === null) {
    return null
  }

  const { firstSwitch: result, method } = firstSwitch

  let text: string
  if (result.kind === 'none_capped') {
    text = '20+, capped'
  } else if (result.kind === 'unknown') {
    text = 'Unknown'
  } else if (method === 'estimate') {
    text = `≈ ${estimateMinutes} min (estimate)`
  } else {
    text = `${formatFirstSwitch(result)} (event)`
  }

  return (
    <p className="text-sm text-ink">
      First switch, preview: <Reported>{text}</Reported>
    </p>
  )
}
```

```tsx
export function CountField({ label, value, method, onChange, prefilled, disabled = false }: CountFieldProps) {
  const id = `count-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        placeholder="leave blank if unknown"
        aria-describedby={prefilled ? hintId : undefined}
        className="w-28"
        onChange={(event) => {
          const raw = event.target.value
          if (!isValidDigitsInput(raw)) {
            return
          }
          onChange(raw)
        }}
      />
      {prefilled ? (
        <p id={hintId} className="text-xs text-ink-muted">
          from recorded events (method: {method ?? 'event'})
        </p>
      ) : null}
    </div>
  )
}
```

In `CountFields` itself, convert the mind-wandering block and the estimate block:

```tsx
      <div className="space-y-1">
        <Label htmlFor="mind-wandering-count" className="text-sm font-medium text-ink">
          Noticed mind-wandering (M)
        </Label>
        <p id="mind-wandering-count-hint" className="text-xs text-ink-muted">
          descriptive only
        </p>
        <Input
          id="mind-wandering-count"
          type="text"
          inputMode="numeric"
          value={value.mindWanderingCount}
          placeholder="leave blank if unknown"
          aria-describedby="mind-wandering-count-hint"
          className="w-28"
          onChange={(event) => {
            if (!isValidDigitsInput(event.target.value)) {
              return
            }
            handleMindWanderingChange(event.target.value)
          }}
        />
      </div>

      <FirstSwitchPreview firstSwitch={firstSwitch} estimateMinutes={value.estimateMinutes} />

      {showEstimateInput ? (
        <div className="space-y-1">
          <Label htmlFor="first-switch-estimate" className="text-sm font-medium text-ink">
            Estimated minute of first switch
          </Label>
          <Input
            id="first-switch-estimate"
            type="text"
            inputMode="numeric"
            value={value.estimateMinutes}
            placeholder="leave blank if unknown"
            className="w-28"
            onChange={(event) => handleEstimateChange(event.target.value)}
          />
        </div>
      ) : null}
```

(Every placeholder above is already the required `"leave blank if unknown"` string — that part of the
brief was already satisfied before this task; only the preview markup, the primitive swap and the
token classes change. `w-28` replaces `min-h-11 w-28` as the only className override on each `Input`:
the generated primitive supplies its own border/background/text/height/disabled styling — matching how
`Recall.tsx`'s `Textarea` conversion carries no border/background className of its own — and the one
thing every one of these fields still needs to state explicitly is that it is a narrow field, not the
primitive's default full width.)

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- CountFields`
Expected: PASS, including the unmodified cases (`'no events -> S and E start blank...'`, `'events -> S
prefilled 2...'`, `'voided off_task events...'`, `'paper tally 4...'`, `'M is labeled descriptive
only'`, `'estimate 25 is rejected client-side'`, `'External interruptions stays editable...'`, and the
`FirstSwitchPreview` null-render case).

Note on what this test proves and what it does not: it proves `CountFields` hands the right tier to
`Reported` for all four states. The actual ink-vs-amber colour mapping for `data-tier="recorded"` vs
`data-tier="uncertain"` lives in Wave 0's `index.css`, outside this file's ownership — confirm the
colours visually with `npm run dev:web`, open a benchmark review with S left blank then typed as `0`
then `3` (no estimate), and check the first-switch line reads plain ink for `20+, capped` and amber
for `Unknown`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/CountFields.tsx apps/web/src/features/benchmark/CountFields.test.tsx
git commit -m "$(cat <<'EOF'
Make the four first-switch preview states visibly distinct

20+, capped and the estimate/event strings are measurements and stay
ink; Unknown is the one genuine gap in instrumentation and now renders
under the uncertain (amber) tier via Reported. Move the S/E, mind-
wandering and estimate fields onto the generated Input/Label
primitives, and convert this file's remaining --color-* references to
the new tokens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 32: Wire the disruption-note counter through `useField`, and convert tokens in `DisruptionField`, `ConditionsFields` and `EligibilityPreview`

**Files:**
- Modify: `apps/web/src/features/benchmark/DisruptionField.tsx`
- Modify: `apps/web/src/features/benchmark/ConditionsFields.tsx`
- Modify: `apps/web/src/features/benchmark/EligibilityPreview.tsx`
- Test: `apps/web/src/features/benchmark/ReviewAttestation.test.tsx`

**Interfaces:**
- Consumes: `@/ui/field.js`'s `useField({ name, description?, error?, required? }): FieldWiring`
  (`inputId`, `labelProps: { htmlFor }`, `controlProps: { id, aria-describedby, aria-invalid,
  aria-required }`, `descriptionProps: { id } | undefined`, `errorProps: { id, role: 'alert' } |
  undefined`); `Label` (`@/ui/shadcn/label.js`); `Textarea` (`@/ui/shadcn/textarea.js`); `Input`
  (`@/ui/shadcn/input.js`).
- Produces: nothing — `DisruptionFieldProps`, `ConditionsFieldsProps`, `EligibilityPreviewProps`,
  `deriveEligibilityPreviewInput` and `IncompleteBanner` all keep their existing shapes; Task 33's
  `BenchmarkReviewPage.tsx` mounts all three exactly as it does today.

The disruption note is one of the five counters design.md's defect list names as "not associated with
their fields" (no `aria-describedby` points at it). `useField` is the fix Wave 0 built for exactly
this, and the note's `<label>`/`<textarea>` pair moves onto the generated `Label`/`Textarea`
primitives at the same time (this unit's scope note above), spread with `field.labelProps`/
`field.controlProps` exactly as `Recall.tsx`'s point fields already do. `useField`'s `inputId`
generation is not part of the frozen surface — only the shape of `FieldWiring` is — so the note's
underlying `id` can change; the two things that must not change are (a) its label text, since that is
the accessible name `getByLabelText('Disruption note (optional)')` and `page.getByLabel(...)` depend
on, and (b) the disruption radios' literal ids, which stay hand-written because
`e2e/benchmark-review.spec.ts` and `e2e/recovery.spec.ts` click `#materially-disrupted-no` directly.

`ReviewAttestation.test.tsx`'s keyboard-traversal test asserts a literal `id` at every tab stop,
including `'disruption-note'` — the one stop whose id this task changes. That single stop is rewritten
to compare by element reference (looked up via `getByLabelText`, which resolves through
`labelProps.htmlFor`/`controlProps.id` regardless of what the generated id actually is) instead of by
string; every other stop's literal id is untouched and keeps its existing assertion.

`ConditionsFields`' three text fields (device format, language, material level) move onto the
generated `Input`/`Label` primitives, same as `CountFields.tsx`'s fields in the previous task — no
counter to wire, no id at risk, `Input`/`Label` forward every prop unchanged, and none of their three
literal ids is referenced by any e2e selector. Its checkboxes are untouched, covered by this unit's
scope note above. `EligibilityPreview`'s hedge — "Preview — the server decides at
finalize" — gets a `signal`-coloured left rule rather than new text or weight, since §3's token table
names `signal` for "anything live or being measured," which a provisional, still-being-computed
eligibility preview literally is; this is a visual-only change verified by eye, not by a DOM
assertion, since a border-colour utility class is not a meaningful thing to lock into a unit test.
Its sibling `IncompleteBanner` keeps its plain `<div role="status">` shape (not the generated
`shadcn/alert`) — swapping a raised-surface component in on top of that specific frozen `role="status"`
buys nothing this brief asks for and is not worth the risk to a preserved-contract attribute.

- [ ] **Step 1: Write the failing test**

In `ReviewAttestation.test.tsx`, replace the `'keyboard-only traversal...'` test's body:

```tsx
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
```

Add this new case in the same `describe('ReviewAttestation', ...)` block, right after the existing
`'disruption starts unanswered and the note is capped at 500'` case:

```tsx
it('disruption note counter is linked to the textarea via aria-describedby', () => {
  renderWithProviders(<Harness />)

  const note = screen.getByLabelText('Disruption note (optional)')
  const describedById = note.getAttribute('aria-describedby')
  expect(describedById).not.toBeNull()
  expect(document.getElementById(describedById ?? '')).toHaveTextContent('0/500')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- ReviewAttestation`
Expected: FAIL — the rewritten keyboard test currently still passes (it happens to describe today's
behaviour), so the new `'disruption note counter is linked...'` case is the one that fails: today's
`disruption-note` textarea has no `aria-describedby` at all, so `describedById` is `null` and the
`expect(describedById).not.toBeNull()` assertion fails.

- [ ] **Step 3: Implement**

Replace `DisruptionField.tsx` in full:

```tsx
/**
 * DisruptionField — the required "materially disrupted" self-attestation
 * (task 8.4.4; design.md D7.2; specs/benchmark-assessment: "Disruption is a
 * required self-attestation" — "External interruptions without disruption").
 * First control of the third section of `/benchmark/:sessionId/scoring`
 * (mounted by `BenchmarkReviewPage`, see this task's edit there).
 *
 * A plain Yes/No radio with NO default value — an unanswered attestation is
 * not the same as "No", so this component never pre-selects an answer, and
 * `BenchmarkReviewPage` never seeds it from `review.materiallyDisrupted`
 * either (that field is written only by finalize, D31, so it is always
 * `null` at this point in the flow regardless). The parent's Finalize step
 * (8.4.5) refuses to finalize until this has a real `'yes' | 'no'` value.
 *
 * The optional note is capped at 500 characters client-side with a visible
 * `n/500` counter, mirroring `Recall.tsx`'s `RecallPoints` counter exactly
 * (this task's own brief names 500, independent of `ReviewInputSchema`'s
 * wider 2000-character wire limit for `disruptionNote` — same reasoning as
 * `Recall.tsx`'s point-length note: a stricter client cap is always a safe
 * subset of a looser wire limit).
 *
 * shadcn-ui-rework (2026-09-09): the note now renders through the generated
 * `Label`/`Textarea` primitives (the rework spec §6/U8's "Label + Input/Textarea/
 * Select plus one small local Field component" pairing — this unit's scope
 * note above), and its counter is wired to the textarea through
 * `@/ui/field.js`'s `useField` (design.md's fix for "character counters not
 * associated with their fields") — `controlProps` carries `aria-describedby`
 * pointing at `descriptionProps.id`, and the rendered `n/500` text lives at
 * that id. The Yes/No radio stays the direct `radix-ui` `RadioGroup` with its
 * own plain `<label>`s, unconverted (this unit's scope note above): the ids
 * stay the literal `materially-disrupted-yes`/`materially-disrupted-no`
 * strings they have always been, because `e2e/benchmark-review.spec.ts` and
 * `e2e/recovery.spec.ts` click `#materially-disrupted-no` directly, and
 * `useField`'s id generation is not part of its frozen contract, so only the
 * note (whose id was never depended on anywhere by string) is routed through
 * it.
 *
 * Fully controlled, single `onChange` (matches `CountFields`'s style):
 * every keystroke or radio pick reports the COMPLETE next `{value, note}`
 * pair upward in one call, so `BenchmarkReviewPage` never has to reconcile
 * two independent setters racing each other.
 */
import { RadioGroup } from 'radix-ui'

import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'

export type DisruptionAnswer = 'yes' | 'no' | null

const MAX_NOTE_LENGTH = 500

export interface DisruptionFieldProps {
  readonly value: DisruptionAnswer
  readonly note: string
  readonly onChange: (value: DisruptionAnswer, note: string) => void
}

export function DisruptionField({ value, note, onChange }: DisruptionFieldProps) {
  const noteField = useField({ name: 'disruption-note', description: 'Character count' })

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-ink">
          Was this session materially disrupted?
        </legend>
        <RadioGroup.Root
          className="flex gap-4"
          required
          value={value ?? null}
          onValueChange={(next) => onChange(next as 'yes' | 'no', note)}
        >
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-yes"
              value="yes"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-rule bg-card data-[state=checked]:border-signal"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-signal" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-yes" className="text-sm text-ink">
              Yes
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-no"
              value="no"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-rule bg-card data-[state=checked]:border-signal"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-signal" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-no" className="text-sm text-ink">
              No
            </label>
          </div>
        </RadioGroup.Root>
      </fieldset>

      <div className="space-y-1">
        <Label {...noteField.labelProps} className="text-sm font-medium text-ink">
          Disruption note (optional)
        </Label>
        <Textarea
          {...noteField.controlProps}
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          onChange={(event) => onChange(value, event.target.value)}
        />
        {noteField.descriptionProps ? (
          <p {...noteField.descriptionProps} className="text-xs text-ink-muted">
            {note.length}/{MAX_NOTE_LENGTH}
          </p>
        ) : null}
      </div>
    </div>
  )
}
```

In `ConditionsFields.tsx`, add these imports after the existing
`import { ACCOMMODATIONS, type Accommodation, type ObservedConditionsValue } from '@attention-lab/shared'`
line:

```tsx
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
```

Then replace `ConditionsFields`'s return statement in full:

```tsx
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={field.id} className="text-sm font-medium text-ink">
              {field.label}
            </Label>
            <Input
              id={field.id}
              type="text"
              value={value[field.key] ?? ''}
              onChange={(event) => handleTextChange(field.key, event.target.value)}
            />
          </div>
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-ink">Accommodations</legend>
        {ACCOMMODATIONS.map((accommodation) => {
          const id = `conditions-accommodation-${accommodation}`
          return (
            <label key={accommodation} htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
              <input
                id={id}
                type="checkbox"
                checked={value.accommodations.includes(accommodation)}
                onChange={(event) => handleAccommodationToggle(accommodation, event.target.checked)}
              />
              {ACCOMMODATION_COPY[accommodation]}
            </label>
          )
        })}
      </fieldset>

      <label
        htmlFor="conditions-confirmed"
        className="flex items-center gap-2 text-sm font-medium text-ink"
      >
        <input
          id="conditions-confirmed"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onChange(value, event.target.checked)}
        />
        These conditions are correct
      </label>
    </div>
  )
```

The accommodations fieldset and the confirm checkbox are reproduced above unchanged from the current
file (still native `<input type="checkbox">`, still their own hand-written `<label>`) — this unit's
scope note above is the reason, and only the three `TEXT_FIELDS` rows and their labels move onto
`Input`/`Label` in this task. `Input` forwards `value`/`onChange` unchanged, so
`handleTextChange`'s existing blank-commits-`null` behaviour is untouched.

In `EligibilityPreview.tsx`, convert tokens and give the preview hedge its accent rule:

```tsx
export function EligibilityPreview({ input }: EligibilityPreviewProps) {
  if (input === null) {
    return (
      <p className="text-sm text-ink-muted" aria-busy="true">
        Eligibility preview — loading
      </p>
    )
  }

  const result = evaluateEligibility(input)

  return (
    <div className="space-y-2">
      <p className="border-l-2 border-signal pl-3 text-sm font-medium text-ink">{PREVIEW_LABEL}</p>
      {result.eligible ? (
        <p className="text-sm text-ink">Eligible</p>
      ) : (
        <ul className="space-y-1 text-sm text-ink-muted">
          {result.exclusionReasons.map((reason) => (
            <li key={reason}>{EXCLUSION_REASON_COPY[reason]}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

And `IncompleteBanner`'s three remaining token classes (`border-[var(--color-border)]`,
`bg-[var(--color-surface)]`, `text-[var(--color-text)]`, all inside its one `className` string):

```tsx
export function IncompleteBanner({ elapsedSeconds }: IncompleteBannerProps) {
  return (
    <div role="status" className="rounded-md border border-rule bg-card p-3 text-sm text-ink">
      <p className="font-medium">Incomplete attempt</p>
      <p>Recorded elapsed time: {formatRemaining(elapsedSeconds)}</p>
    </div>
  )
}
```

`Incomplete attempt` is a recorded fact about this attempt (the interval genuinely did not complete),
not a gap in the data — it stays `text-ink` via the surrounding `role="status"` container above, never
the amber `attention` token, matching the taxonomy's rule that a known fact is the recorded tier even
when it is bad news.

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- ReviewAttestation`
Expected: PASS, including every pre-existing case (`'E=2 with disruption No...'`, `'disruption Yes
lists...'`, `'accommodation checkbox adds...'`, `'conditions default from
review.observedConditions'`, `'canFinalize stays false...'`, `'completeInterval false renders...'`,
`'preview is labeled preview...'`).

Note on what these tests prove and what they do not: nothing here has a DOM assertion for the
`EligibilityPreview` hedge's new `border-l-2 border-signal` left rule — a border-colour utility class
is not a meaningful thing to lock into a unit test. Confirm it visually instead, with
`npm run dev:web`: open a benchmark review, answer the disruption radio either way, and check that
"Preview — the server decides at finalize" carries a petrol-coloured left rule distinguishing it from
a plain paragraph, while the exclusion-reason list beneath it stays plain `ink-muted` text with no
rule of its own.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/DisruptionField.tsx apps/web/src/features/benchmark/ConditionsFields.tsx apps/web/src/features/benchmark/EligibilityPreview.tsx apps/web/src/features/benchmark/ReviewAttestation.test.tsx
git commit -m "$(cat <<'EOF'
Wire the disruption note counter through useField

Its n/500 counter had no aria-describedby, one of design.md's named
unlinked-counter defects. Route it through the new Field wiring, move
the note and ConditionsFields' three text fields onto the generated
Label/Textarea/Input primitives, and convert the remaining --color-*
references across DisruptionField, ConditionsFields and
EligibilityPreview to the new tokens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 33: Group the review into Recall / Counts / Disruption and conditions / Finalize, and wire the review-note counter

**Files:**
- Modify: `apps/web/src/features/benchmark/BenchmarkReviewPage.tsx`
- Modify: `apps/web/src/features/benchmark/Finalize.tsx`
- Test: `apps/web/src/features/benchmark/BenchmarkReviewPage.test.tsx`
- Test: `apps/web/src/features/benchmark/Finalize.test.tsx`

**Interfaces:**
- Consumes: `@/ui/field.js`'s `useField` (same signature as Task 32); `Label` (`@/ui/shadcn/label.js`);
  `Textarea` (`@/ui/shadcn/textarea.js`); `Scoring`, `CountFields`, `DisruptionField`,
  `ConditionsFields`, `EligibilityPreview`, `IncompleteBanner`, `FinalizeSection` exactly as
  `BenchmarkReviewPage.tsx` already imports them (Task 30–24 changed their internals, not their props).
- Produces: nothing — `BenchmarkReviewPage` and `FinalizeSection`/`FinalizeBar`/
  `buildFinalizeReviewBody` keep their existing exported shapes.

design.md names this screen "the densest form in the app, read as one continuous log entry: Recall →
Counts → Disruption and conditions → Finalize, each block opening with a plain title and a hairline."
Today the four sections are separated only by `space-y-8`, with no heading distinguishing them. This
task adds the four `<h2>` titles and the between-section hairlines, and — since `Finalize.tsx` is the
container for the last of those four sections — also wires its `reviewNote` counter through
`useField`, the same fix Task 32 applied to `disruptionNote`, moving its `<label>`/`<textarea>` pair
onto the generated `Label`/`Textarea` primitives at the same time (this unit's scope note above). No
e2e spec depends on `Finalize.tsx`'s current `id="review-note"` by CSS selector (the one
Playwright/unit check on a literal `'review-note'` id belongs to the unrelated practice-review
screen's own field, a different accessible name — `'Notes (optional)'` there vs `'Anything else to
note?'` here — owned by a different file this unit does not touch), so this counter carries none of
Task 32's id-preservation constraint.

- [ ] **Step 1: Write the failing test**

Add this case to `BenchmarkReviewPage.test.tsx`'s `describe('BenchmarkReviewPage', ...)` block, after
the existing `'mounts the Scoring section...'` case (same `respond`/`renderPage`/`makeSession` helpers
already in the file):

```tsx
it('groups the review into Recall, Counts, Disruption and conditions, and Finalize sections', async () => {
  respond('sessions.get', makeSession())

  renderPage()

  await screen.findByText('Recall must be saved first')

  expect(screen.getByRole('heading', { level: 2, name: 'Recall' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Counts' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Disruption and conditions' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Finalize' })).toBeInTheDocument()
})
```

Add this case to `Finalize.test.tsx`'s existing describe block, after the `'reviewNote included only
when non-blank'` case:

```tsx
it('review note counter is linked to the textarea via aria-describedby', () => {
  mockHook()
  renderSection()

  const note = screen.getByLabelText('Anything else to note?')
  const describedById = note.getAttribute('aria-describedby')
  expect(describedById).not.toBeNull()
  expect(document.getElementById(describedById ?? '')).toHaveTextContent('0/500')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- BenchmarkReviewPage Finalize`
Expected: FAIL on both new cases — today's page has no `role="heading"` elements named `'Recall'`,
`'Counts'`, `'Disruption and conditions'` or `'Finalize'`, and today's `review-note` textarea has no
`aria-describedby` at all.

- [ ] **Step 3: Implement**

In `BenchmarkReviewPage.tsx`, replace the final render block:

```tsx
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-8">
      <h1 className="text-lg font-semibold text-ink">Benchmark review</h1>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-ink-muted">Recall</h2>
        <Scoring session={session} review={session.review} onChange={handleScoringChange} />
      </section>

      <section className="space-y-4 border-t border-rule pt-8">
        <h2 className="text-sm font-medium text-ink-muted">Counts</h2>
        <CountFields session={session} value={countFieldsValue} onChange={setCountFieldsValue} />
      </section>

      <section className="space-y-6 border-t border-rule pt-8">
        <h2 className="text-sm font-medium text-ink-muted">Disruption and conditions</h2>

        {session.completeInterval === false ? (
          <IncompleteBanner elapsedSeconds={session.timing.elapsedSeconds} />
        ) : null}

        <DisruptionField value={materiallyDisrupted} note={disruptionNote} onChange={handleDisruptionChange} />

        <ConditionsFields value={conditions} confirmed={conditionsConfirmed} onChange={handleConditionsChange} />

        <EligibilityPreview input={eligibilityInput} />
      </section>

      <section className="space-y-4 border-t border-rule pt-8">
        <h2 className="text-sm font-medium text-ink-muted">Finalize</h2>
        <FinalizeSection
          session={session}
          countFieldsValue={countFieldsValue}
          recallScores={recallScores}
          scoringComplete={scoringComplete}
          materiallyDisrupted={materiallyDisrupted}
          disruptionNote={disruptionNote}
          conditions={conditions}
          conditionsConfirmed={conditionsConfirmed}
          nextAction={currentQuery.data?.nextAction}
        />
      </section>
    </div>
  )
```

(`text-[var(--color-text)]` on the `<h1>` becomes `text-ink` in the same edit.)

In `Finalize.tsx`, add these imports after the existing `import { Button } from '../../ui/Button.js'`
line:

```tsx
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
```

Convert `FinalizeBar`'s two token classes:

```tsx
      {missing.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink-muted" aria-label="What is missing before you can finalize">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      <Button type="button" variant="primary" disabled={primaryDisabled} onClick={onFinalize}>
        Finalize
      </Button>

      {message !== null ? (
        <div role="status" className="flex items-center gap-3 text-sm text-ink">
          <p>{message}</p>
          <Button type="button" variant="secondary" onClick={onFinalize}>
            Retry
          </Button>
        </div>
      ) : null}
```

Add the `useField` call inside `FinalizeSection`, alongside its existing `useState`/`useFinalizeSession`
calls (before the `status === 'success'` early return, since hooks must run unconditionally):

```tsx
export function FinalizeSection({
  session,
  countFieldsValue,
  recallScores,
  scoringComplete,
  materiallyDisrupted,
  disruptionNote,
  conditions,
  conditionsConfirmed,
  nextAction,
}: FinalizeSectionProps) {
  const [reviewNote, setReviewNote] = useState('')
  const reviewNoteField = useField({ name: 'review-note', description: 'Character count' })
  const finalizeHook = useFinalizeSession(session.id)
```

And replace the review-note markup, moving it onto the generated `Label`/`Textarea` primitives the
same way Task 32 moved `DisruptionField`'s note:

```tsx
      <div className="space-y-1">
        <Label {...reviewNoteField.labelProps} className="text-sm font-medium text-ink">
          Anything else to note?
        </Label>
        <Textarea
          {...reviewNoteField.controlProps}
          value={reviewNote}
          maxLength={MAX_REVIEW_NOTE_LENGTH}
          rows={3}
          onChange={(event) => setReviewNote(event.target.value)}
        />
        {reviewNoteField.descriptionProps ? (
          <p {...reviewNoteField.descriptionProps} className="text-xs text-ink-muted">
            {reviewNote.length}/{MAX_REVIEW_NOTE_LENGTH}
          </p>
        ) : null}
      </div>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- BenchmarkReviewPage Finalize`
Expected: PASS, including every pre-existing case in both files (`'shows a loading state...'`,
`'error state offers Retry...'` in `BenchmarkReviewPage.test.tsx`; every `FinalizeSection` case in
`Finalize.test.tsx`, including `'Finalize enabled on an incomplete attempt...'`, which reads
`finalize.mock.calls[0]?.[0]` and is unaffected by the note's id).

Note on what this test proves and what it does not: the `<h2>` titles are proven by the new heading
query above, but the `border-t border-rule pt-8` hairline between each section has no DOM assertion —
a border utility class is not a meaningful thing to lock into a unit test. Confirm it visually with
`npm run dev:web`: open a benchmark review and check that Counts, "Disruption and conditions" and
Finalize each open below a plain hairline rule, with Recall (the first section) opening with no
hairline above it since there is nothing to separate it from.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmark/BenchmarkReviewPage.tsx apps/web/src/features/benchmark/Finalize.tsx apps/web/src/features/benchmark/BenchmarkReviewPage.test.tsx apps/web/src/features/benchmark/Finalize.test.tsx
git commit -m "$(cat <<'EOF'
Read the benchmark review as one continuous log entry

Recall, Counts, Disruption and conditions, and Finalize each open
with a plain title and a hairline instead of blending together. Wire
Finalize's own review-note counter through useField, move it onto the
generated Label/Textarea primitives, and convert the remaining
--color-* references in both files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Focus: live practice session

### Task 34: TimerDisplay's 56px instrument face, and Focus's hairline-separated shell

**Files:**
- Modify: `apps/web/src/features/focus/TimerDisplay.tsx`
- Modify: `apps/web/src/features/focus/TimerDisplay.test.tsx`
- Modify: `apps/web/src/features/focus/Focus.tsx`
- Modify: `apps/web/src/features/focus/Focus.test.tsx`

**Interfaces:**
- Consumes: nothing new from the frozen list — this task is a pure token/size change. (No `Reported`/`useField`/shadcn primitive touches any file in this task.)
- Produces: `TimerDisplayProps.tone?: 'ink' | 'signal'` — an optional prop later tasks (Benchmark Running, a different unit) may pass `'signal'` to render the live-benchmark petrol countdown; every existing caller (`Recall.tsx` line 351, `Focus.tsx` line 270, and `apps/web/src/features/benchmark/Running.tsx` line 176) omits `tone` entirely and so keeps the default `'ink'`, visually unchanged by this addition. `Running.tsx` is the one of the three a later benchmark-unit task will pass `tone="signal"` from — out of scope here since `src/features/benchmark/` is a different Wave-1 unit's file ownership.

`SyncStatus.tsx` needs **no code change** in this task: it already contains zero `var(--color-*)` references (confirmed by inspection — its only styling is `flex flex-wrap items-center gap-2 text-sm` plus the shared `Button`). The "quiet utility strip separated only by hairlines" requirement is carried entirely by Focus.tsx's own wrapping `<div>`s, not by anything inside `SyncStatus.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `TimerDisplay.test.tsx`, inside `describe('TimerDisplay', ...)`, right after the existing `'hideTimerDefault preference seeds hidden state'` case:

```tsx
  it('digits render at the 56px instrument size in ink by default, not the old 36px size', async () => {
    mount({ remainingSeconds: 600, hidden: false })

    const digits = await screen.findByTestId('timer-digits')
    expect(digits.className).toMatch(/text-\[56px\]/)
    expect(digits.className).toMatch(/\btext-ink\b/)
    expect(digits.className).not.toMatch(/text-4xl/)
  })

  it('tone="signal" renders the digits in the signal token instead of ink; ink stays the default', async () => {
    const utils = mount({ remainingSeconds: 600, hidden: false, tone: 'signal' })
    const signalDigits = await screen.findByTestId('timer-digits')
    expect(signalDigits.className).toMatch(/\btext-signal\b/)
    expect(signalDigits.className).not.toMatch(/\btext-ink\b/)

    rerenderWith(utils, { remainingSeconds: 600, hidden: false })
    const inkDigits = screen.getByTestId('timer-digits')
    expect(inkDigits.className).toMatch(/\btext-ink\b/)
  })
```

Add to `Focus.test.tsx`, inside `describe('Focus', ...)`, right after the existing `'sync status is rendered from the outbox state'` case (the file's last case):

```tsx
  it('the pause/agent-plan group and the tallies/sync group each sit below exactly one hairline, never a boxed card', async () => {
    const session = makeSession({ id: 'session-hairline' })
    respond('sessions.get', session)

    const { container } = renderFocus(session.id)
    await screen.findByTestId('timer-digits')

    const hairlines = container.querySelectorAll('.border-t.border-rule')
    expect(hairlines).toHaveLength(2)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- TimerDisplay.test.tsx Focus.test.tsx`
Expected: FAIL — the two new `TimerDisplay` cases fail on their runtime class assertions: the rendered `timer-digits` element's `className` still contains `text-4xl` and no `text-[56px]`/`text-ink`/`text-signal` token classes exist yet, so `expect(digits.className).toMatch(/text-\[56px\]/)` fails first in the size case, and `expect(signalDigits.className).toMatch(/\btext-signal\b/)` fails first in the tone case. (`apps/web/vitest.config.ts` runs Vitest under its `jsdom`/`node` `projects` with no `test.typecheck` block, and `npm run test -w @attention-lab/web` is plain `vitest run` — esbuild strips types without checking them, so passing the not-yet-declared `tone: 'signal'` prop does not fail this test run with a type error; `tsc` only runs separately, via `npm run typecheck`.) The new `Focus` case fails with `expect(hairlines).toHaveLength(2)` receiving `0`, since no element in the current tree carries `.border-t.border-rule`.

- [ ] **Step 3: Implement**

Replace `TimerDisplay.tsx`'s props interface and render body:

```tsx
export interface TimerDisplayProps {
  /** Always supplied by `lib/clock` (via `useRemaining(session)`, D5) — this component never accumulates ticks itself. */
  remainingSeconds: number
  /**
   * Optional controlled override. When omitted, the component manages its
   * own hidden state, seeded once from `preferences.hideTimerDefault`
   * (GET /me) — the brief's "initial state comes from" behavior. When
   * supplied, the caller owns the value and `onToggleHidden` is the only
   * way the toggle takes effect.
   */
  hidden?: boolean
  onToggleHidden?: (hidden: boolean) => void
  /**
   * 'signal' marks a countdown that IS the live measurement itself (the
   * fixed 20-minute benchmark) — the petrol distinguishes a benchmark from
   * a variable-length practice block (the rework spec §8, "Benchmark: ready and
   * running"). Every caller in this codebase today (Focus's practice block,
   * Recall's fixed recall window) keeps the default 'ink'; a benchmark
   * Running screen is the one place a later change opts into 'signal'.
   */
  tone?: 'ink' | 'signal'
}
```

```tsx
export function TimerDisplay({ remainingSeconds, hidden: hiddenProp, onToggleHidden, tone = 'ink' }: TimerDisplayProps) {
  const { preferences } = useMeContext()
  const [internalHidden, setInternalHidden] = useState(() => preferences.hideTimerDefault)
  const hidden = hiddenProp ?? internalHidden
  const prefersReducedMotion = usePrefersReducedMotion()

  useEndChime(remainingSeconds, preferences.endChime)
  useMilestoneAnnouncements({
    remainingSeconds,
    enabled: preferences.milestoneAnnouncements,
    milestonesSeconds: MILESTONES_SECONDS,
  })

  function handleToggle(): void {
    const next = !hidden
    onToggleHidden?.(next)
    if (hiddenProp === undefined) {
      setInternalHidden(next)
    }
  }

  const transitionClass = prefersReducedMotion ? '' : 'transition-opacity duration-200'
  const toneClass = tone === 'signal' ? 'text-signal' : 'text-ink'
  const textClass = ['text-[56px] font-mono tabular-nums leading-none tracking-tight', toneClass, transitionClass]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col items-center gap-3">
      {hidden ? (
        <p className={textClass} data-testid="timer-hidden-text">
          Timer hidden
        </p>
      ) : (
        <p className={textClass} data-testid="timer-digits">
          {formatRemaining(remainingSeconds)}
        </p>
      )}
      <Button variant="quiet" onClick={handleToggle}>
        {hidden ? 'Show timer' : 'Hide timer'}
      </Button>
    </div>
  )
}
```

In `Focus.tsx`, convert `SessionHeader`'s tokens and restructure the running-session body into two hairline-separated groups below the countdown and the one primary logging button. Before:

```tsx
export function SessionHeader({ intendedOutput, targetSeconds }: SessionHeaderProps) {
  const targetMinutes = Math.round(targetSeconds / 60)
  return (
    <header className="space-y-1">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Practice block</h1>
      <p className="text-sm text-[var(--color-text)]">{intendedOutput ?? 'No intended output recorded'}</p>
      <p className="text-sm text-[var(--color-text-muted)]">{`Target: ${targetMinutes} min`}</p>
    </header>
  )
}
```

After:

```tsx
export function SessionHeader({ intendedOutput, targetSeconds }: SessionHeaderProps) {
  const targetMinutes = Math.round(targetSeconds / 60)
  return (
    <header className="space-y-1">
      <h1 className="text-lg font-semibold text-ink">Practice block</h1>
      <p className="text-sm text-ink">{intendedOutput ?? 'No intended output recorded'}</p>
      <p className="text-sm text-ink-muted">{`Target: ${targetMinutes} min`}</p>
    </header>
  )
}
```

And the running-session JSX. Before:

```tsx
      ) : (
        <div className="space-y-4">
          <TimerDisplay remainingSeconds={remaining ?? session.targetSeconds} />
          <TransitionControls session={session} />
          <AgentPanel
            sessionId={session.id}
            sessionVersion={session.version}
            plan={session.agentPlan}
            lifecycle={session.lifecycle}
          />
          <EventButtons
            sessionId={session.id}
            variant="practice"
            onRecord={(type, details) => {
              void events.record(type, details)
            }}
            onUndo={() => {
              void events.undo()
            }}
            canUndo={events.canUndo}
          />
          {events.undoNotice !== null ? <p role="alert">{events.undoNotice}</p> : null}
        </div>
      )}

      <Tallies offTask={events.tallies.offTask} external={events.tallies.external} agentChecks={events.tallies.agentChecks} />
      <SyncStatus sessionId={session.id} />
    </div>
  )
}
```

After — the countdown and the single effortless logging button stay unindented and first; Pause/agent-plan and the tallies/sync readout each drop below their own hairline, matching the rework spec §8's "Pause, agent plan and sync are a quiet utility strip separated only by hairlines, never boxed":

```tsx
      ) : (
        <div className="space-y-6">
          <TimerDisplay remainingSeconds={remaining ?? session.targetSeconds} />
          <EventButtons
            sessionId={session.id}
            variant="practice"
            onRecord={(type, details) => {
              void events.record(type, details)
            }}
            onUndo={() => {
              void events.undo()
            }}
            canUndo={events.canUndo}
          />
          {events.undoNotice !== null ? (
            <p role="alert" className="text-sm text-ink-muted">
              {events.undoNotice}
            </p>
          ) : null}

          <div className="space-y-4 border-t border-rule pt-4">
            <TransitionControls session={session} />
            <AgentPanel
              sessionId={session.id}
              sessionVersion={session.version}
              plan={session.agentPlan}
              lifecycle={session.lifecycle}
            />
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-rule pt-4">
        <Tallies offTask={events.tallies.offTask} external={events.tallies.external} agentChecks={events.tallies.agentChecks} />
        <SyncStatus sessionId={session.id} />
      </div>
    </div>
  )
}
```

Also convert the deadline-reached branch's status text to the new tokens (this file's local `RetryNotice` — the one Focus.tsx itself defines, mirroring `Ready.tsx`'s copy — already renders its `<p>{message}</p>` with no className at all, so there is no `--color-*` token in it to convert). Before:

```tsx
      {deadlineReached ? (
        <div className="space-y-4">
          <p role="status">{DEADLINE_MESSAGE}</p>
```

After:

```tsx
      {deadlineReached ? (
        <div className="space-y-4">
          <p role="status" className="text-ink">
            {DEADLINE_MESSAGE}
          </p>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- TimerDisplay.test.tsx Focus.test.tsx`
Expected: PASS — all pre-existing cases in both files (including `'no element with aria-live contains the countdown digits while running'`, `digits.closest('[aria-live]')` being `null`, and every `Focus.test.tsx` case that queries by role/text/testid) keep passing unmodified, since none of them depend on the digits' font size, color class, or the DOM position of `TransitionControls`/`AgentPanel`/`Tallies`/`SyncStatus` relative to one another.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/focus/TimerDisplay.tsx apps/web/src/features/focus/TimerDisplay.test.tsx apps/web/src/features/focus/Focus.tsx apps/web/src/features/focus/Focus.test.tsx
git commit -m "Focus: 56px instrument-face timer digits and a hairline-separated session shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u"
```

---

### Task 35: EventButtons' effortless logging button and Tallies — off the last `--color-*` tokens, the agent-check checkbox onto shadcn

**Files:**
- Modify: `apps/web/src/features/focus/EventButtons.tsx`
- Modify: `apps/web/src/features/focus/Tallies.tsx`
- Modify: `apps/web/src/features/focus/EventButtons.test.tsx`

**Interfaces:**
- Consumes: `Checkbox` from `@/ui/shadcn/checkbox.js` (`checked: boolean | 'indeterminate'`, `onCheckedChange(checked)`, forwards `id`/`aria-*`/`className`); `Label` from `@/ui/shadcn/label.js` (`htmlFor`, `className`, children); `useField` from `@/ui/field.js`.
- Produces: nothing new — `EventButtonsProps`, `AgentCheckConfirmProps` and `TalliesProps` are unchanged; this task only converts internals and tokens.

- [ ] **Step 1: Write the failing test**

Add to `EventButtons.test.tsx`, inside `describe('EventButtons + useSessionEvents', ...)`, right after the existing `'agent check marked also off-task -> offTask 1, agentChecks 1, and no element with text 2'` case (the checkbox it already drives is reused here, so no new harness is needed):

```tsx
  it('the also-off-task control is a real checkbox (shadcn/Radix), not the old bare <input>, and the confirm group carries no legacy --color- token', async () => {
    await mountReady()

    fireEvent.click(screen.getByText('Agent check'))
    const alsoOffTask = screen.getByLabelText('This was also an off-task episode')

    expect(alsoOffTask).toHaveAttribute('role', 'checkbox')
    expect(alsoOffTask.tagName).not.toBe('INPUT')

    const group = screen.getByRole('group', { name: 'Confirm agent check' })
    expect(group.className).toMatch(/\bborder-rule\b/)
    expect(group.className).not.toMatch(/--color-/)
  })

  it('Tallies renders its labels in the ink-muted token, not the retired --color-text-muted variable', async () => {
    await mountReady()

    const offTaskLabel = screen.getByText('Off-task')
    expect(offTaskLabel.className).toMatch(/\btext-ink-muted\b/)
    expect(offTaskLabel.className).not.toMatch(/--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- EventButtons.test.tsx`
Expected: FAIL, both new cases — but not for every reason their own assertions might suggest, since Vitest stops an `it` block at its first failed assertion. In the first case (checkbox + confirm group, one `it` block), `alsoOffTask` is currently a native `<input type="checkbox">`, which carries the checkbox role only implicitly (via browser semantics), never as a literal `role` DOM attribute — so the very FIRST assertion, `expect(alsoOffTask).toHaveAttribute('role', 'checkbox')`, fails immediately (jest-dom's `toHaveAttribute` checks the actual attribute, not the computed accessibility role). Execution stops there: the `.tagName` check and the confirm group's two `border-rule`/`--color-` assertions later in the SAME `it` block are never reached on this run, even though the group's `className` (currently `border-[var(--color-border)]`) would also fail its own assertion if it were reached. The second case fails on its own first assertion: `Tallies`' `<dt>` currently carries `text-[var(--color-text-muted)]`, so `expect(offTaskLabel.className).toMatch(/\btext-ink-muted\b/)` fails before the `.not.toMatch(/--color-/)` line after it is ever reached.

- [ ] **Step 3: Implement**

`EventButtons.tsx`'s current first two import lines are:

```tsx
import { useId, useState } from 'react'
import { Button } from '../../ui/Button.js'
```

Modify the first line — `useId` is used nowhere else in this file (confirmed by grep: its only call site is `AgentCheckConfirm`'s own `checkboxId`, which the replacement below removes) — from:

```tsx
import { useId, useState } from 'react'
```

to:

```tsx
import { useState } from 'react'
```

Then add these new lines directly after the existing `import { Button } from '../../ui/Button.js'` line:

```tsx
import { Checkbox } from '../../ui/shadcn/checkbox.js'
import { Label } from '../../ui/shadcn/label.js'
import { useField } from '../../ui/field.js'
```

Replace `AgentCheckConfirm`:

```tsx
/** The inline confirm `EventButtons` opens for its 'Agent check' control. */
export function AgentCheckConfirm({ onConfirm, onCancel }: AgentCheckConfirmProps) {
  const { controlProps, labelProps } = useField({ name: 'agent-check-also-off-task' })
  const [alsoOffTask, setAlsoOffTask] = useState(false)

  return (
    <div role="group" aria-label="Confirm agent check" className="flex flex-col gap-2 rounded-md border border-rule p-3">
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={controlProps.id}
          aria-describedby={controlProps['aria-describedby']}
          checked={alsoOffTask}
          onCheckedChange={(checked) => setAlsoOffTask(checked === true)}
        />
        <Label {...labelProps}>This was also an off-task episode</Label>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => onConfirm(alsoOffTask)}>
          Log agent check
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

Replace `Tallies.tsx` in full:

```tsx
/**
 * Renders the D11 tallies computed by `sessionTallies.ts`/`useSessionEvents.ts` —
 * plain numbers, three separate `<dd>` elements so no rendered element's own
 * text is ever a summed figure (task 8.5.1; design.md D11; CLAUDE.md's "no
 * invented attention score"). `agentChecks` is genuinely optional: the
 * benchmark variant of `EventButtons` has no Agent check control at all, so
 * a caller for that variant omits the prop entirely rather than passing a
 * permanently-zero count for a thing the screen never offers to record.
 */
export interface TalliesProps {
  readonly offTask: number
  readonly external: number
  readonly agentChecks?: number
}

export function Tallies({ offTask, external, agentChecks }: TalliesProps) {
  return (
    <dl className="flex flex-wrap gap-4 text-sm">
      <div className="flex items-baseline gap-1">
        <dt className="text-ink-muted">Off-task</dt>
        <dd className="font-medium tabular-nums">{offTask}</dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-ink-muted">External interruptions</dt>
        <dd className="font-medium tabular-nums">{external}</dd>
      </div>
      {agentChecks !== undefined && (
        <div className="flex items-baseline gap-1">
          <dt className="text-ink-muted">Agent checks</dt>
          <dd className="font-medium tabular-nums">{agentChecks}</dd>
        </div>
      )}
    </dl>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- EventButtons.test.tsx`
Expected: PASS — including every pre-existing case unmodified: `'agent check marked also off-task -> ...'` and `'agent check without the flag -> ...'` still drive the confirm via `fireEvent.click(screen.getByLabelText('This was also an off-task episode'))`, which resolves identically to the new Radix `Checkbox` (label-to-id association, independent of the underlying tag).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/focus/EventButtons.tsx apps/web/src/features/focus/Tallies.tsx apps/web/src/features/focus/EventButtons.test.tsx
git commit -m "Focus: move the agent-check confirm onto shadcn Checkbox/Label and retire the last --color- tokens in the logging surface

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u"
```

---

### Task 36: AgentPanel's plan editor onto shadcn Input/Label/Select/Textarea/Collapsible

**Files:**
- Modify: `apps/web/src/features/focus/AgentPanel.tsx`
- Modify: `apps/web/src/features/focus/AgentPanel.test.tsx`

**Interfaces:**
- Consumes: `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` from `@/ui/shadcn/collapsible.js`; `Input` from `@/ui/shadcn/input.js`; `Textarea` from `@/ui/shadcn/textarea.js`; `Label` from `@/ui/shadcn/label.js`; `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from `@/ui/shadcn/select.js`; `useField` from `@/ui/field.js`; `Button` (`variant`, `asChild`) from `@/ui/Button.js`.
- Produces: nothing new — `PlanFieldsProps`, `PlanDraftValue`, `draftFromPlan`, `AgentPanelProps` are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `AgentPanel.test.tsx`, inside `describe('AgentPanel', ...)`, right after the existing `'a 201-character field is blocked'` case (the file's last case):

```tsx
  it('the trigger is the shared quiet Button, not a hand-rolled trigger className', async () => {
    renderWithProviders(<AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />)

    const trigger = screen.getByRole('button', { name: 'Waiting on an agent?' })
    expect(trigger).toHaveAttribute('data-variant', 'quiet')
  })

  it('every field carries no retired --color- token', async () => {
    const { user } = renderWithProviders(
      <AgentPanel sessionId="focus-session" sessionVersion={1} plan={null} lifecycle="running" />,
    )
    await openPanel(user)

    expect(screen.getByLabelText('Workstream').className).not.toMatch(/--color-/)
    expect(screen.getByLabelText('Useful task while waiting').className).not.toMatch(/--color-/)
    expect(screen.getByLabelText('Resume note').className).not.toMatch(/--color-/)
    expect(screen.getByRole('combobox', { name: 'Next review checkpoint' }).className).not.toMatch(/--color-/)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- AgentPanel.test.tsx`
Expected: FAIL — the trigger is currently a bare `Collapsible.Trigger` with a hand-rolled `className` and no `data-variant` attribute at all, so `toHaveAttribute('data-variant', 'quiet')` fails; every field's `className` currently contains `border-[var(--color-border)]`/`bg-[var(--color-bg)]`/`text-[var(--color-text)]` or their `disabled:` variants, matching `/--color-/` and failing the `.not.toMatch` assertions.

- [ ] **Step 3: Implement**

Replace the imports:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AgentPlanBodyValue, AgentPlanResponseValue, SessionLifecycle } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/shadcn/collapsible.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/shadcn/select.js'
import { Textarea } from '../../ui/shadcn/textarea.js'
import { useTransition } from './TransitionControls.js'
```

Replace `PlanFields` in full:

```tsx
export function PlanFields({ value, onChange, disabled = false }: PlanFieldsProps) {
  const workstream = useField({ name: 'agent-plan-workstream' })
  const waitingTask = useField({ name: 'agent-plan-waiting-task' })
  const checkpoint = useField({ name: 'agent-plan-checkpoint' })
  const resumeNote = useField({ name: 'agent-plan-resume-note' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label {...workstream.labelProps}>Workstream</Label>
        <Input
          {...workstream.controlProps}
          type="text"
          value={value.workstream}
          maxLength={WORKSTREAM_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, workstream: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label {...waitingTask.labelProps}>Useful task while waiting</Label>
        <Input
          {...waitingTask.controlProps}
          type="text"
          value={value.waitingTask}
          maxLength={WAITING_TASK_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, waitingTask: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label {...checkpoint.labelProps}>Next review checkpoint</Label>
        <Select
          value={value.reviewCheckpoint}
          onValueChange={(next) => onChange({ ...value, reviewCheckpoint: next as 'end_of_block' })}
          disabled={disabled}
        >
          <SelectTrigger {...checkpoint.controlProps} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="end_of_block">End of this block</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label {...resumeNote.labelProps}>Resume note</Label>
        <Textarea
          {...resumeNote.controlProps}
          value={value.resumeNote}
          maxLength={RESUME_NOTE_MAX_LENGTH}
          rows={3}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, resumeNote: event.target.value })}
        />
      </div>
    </div>
  )
}
```

Replace the `Collapsible.Root`/`Collapsible.Trigger`/`Collapsible.Content` usage at the bottom of `AgentPanel`. Before:

```tsx
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <Collapsible.Trigger
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-transparent px-4 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
      >
        Waiting on an agent?
      </Collapsible.Trigger>

      <Collapsible.Content className="flex flex-col gap-4 pt-1">
```

After:

```tsx
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsibleTrigger asChild>
        <Button variant="quiet">Waiting on an agent?</Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-4 pt-1">
```

...and its closing tags. Before:

```tsx
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
```

After:

```tsx
      </CollapsibleContent>
    </Collapsible>
  )
}
```

Finally, convert the remaining `--color-*` text tokens in the notice/message paragraphs (`STALE_MESSAGE`, `saveMessage`, `breakMessage`) from `text-[var(--color-text-muted)]` to `text-ink-muted` — three identical one-line swaps, e.g.:

```tsx
        {staleNotice ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-ink-muted">
              {STALE_MESSAGE}
            </p>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- AgentPanel.test.tsx`
Expected: PASS — every pre-existing case keeps passing unmodified, including `'checkpoint defaults to end_of_block'` (the `combobox` role and its accessible name survive the swap to shadcn `Select`), `'a 201-character field is blocked'` (`maxLength` still forwards through `Input`'s native props), and `'409 stale keeps the first values...'` (the three text fields still resolve via `getByLabelText`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/focus/AgentPanel.tsx apps/web/src/features/focus/AgentPanel.test.tsx
git commit -m "Focus: rebuild the agent-plan editor on shadcn Input/Select/Textarea/Collapsible and Field wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u"
```

---

### Task 37: TransitionControls, ClockGapPrompt and AbandonSession onto the one shadcn AlertDialog

**Files:**
- Modify: `apps/web/src/features/focus/TransitionControls.tsx`
- Modify: `apps/web/src/features/focus/ClockGapPrompt.tsx`
- Modify: `apps/web/src/features/focus/AbandonSession.tsx`
- Modify: `apps/web/src/features/focus/TransitionControls.test.tsx`
- Modify: `apps/web/src/features/focus/ClockGapPrompt.test.tsx`
- Modify: `apps/web/src/features/focus/AbandonSession.test.tsx`

**Interfaces:**
- Consumes: `AlertDialog`/`AlertDialogPortal`/`AlertDialogOverlay`/`AlertDialogTrigger`/`AlertDialogContent`/`AlertDialogTitle`/`AlertDialogDescription` from `@/ui/shadcn/alert-dialog.js`; `Reported` from `@/ui/Reported.js` (`absenceTier('Timing uncertain') === 'uncertain'`, per the frozen table); `Input`/`Label` from `@/ui/shadcn/input.js` / `@/ui/shadcn/label.js`; `useField` from `@/ui/field.js`; `Button` (`variant`, `asChild`, `ref`) from `@/ui/Button.js`.
- Produces: nothing new — `TransitionControlsProps`, `useTransition`/`UseTransitionResult`, `ClockGapPromptProps` and `AbandonSessionProps` are all unchanged; `AgentPanel.tsx` (Task 36) keeps importing `useTransition` from this same file unaffected.

This is the consolidation the unit brief calls out as "the single biggest reduction in the rework": all three files currently hand-build their own `AlertDialog.Overlay`/`AlertDialog.Content` classes (`DIALOG_OVERLAY_CLASSES`/`DIALOG_CONTENT_CLASSES` in `TransitionControls.tsx`, the same two literal strings inlined directly in `ClockGapPrompt.tsx` and `AbandonSession.tsx`). After this task none of the three files defines its own dialog chrome className at all — the shadcn `AlertDialogOverlay`/`AlertDialogContent` primitives already carry the fixed/centered/rounded/`bg-card`/`border-rule` look, and every call site passes only the behavioral props (`onEscapeKeyDown`, `data-testid`) it actually needs.

`TransitionControls.tsx`'s `focusOnMount` callback ref is carried across **verbatim** — same implementation, same comment, attached to the same "Keep going" `Button`'s `ref`. Do not attempt a `useEffect` in its place: Radix's `AlertDialog.Content` (shadcn's wrapper included, since it wraps the same underlying primitive) portals its children, so an effect keyed on `confirmOpen` reads `null` on the very render it needs the node.

- [ ] **Step 1: Write the failing test**

Add to `TransitionControls.test.tsx`, inside `describe('TransitionControls', ...)`, right after the existing `'finish early confirms, posts end and routes to /review/:id'` case:

```tsx
  // Regression guard, not a newly-failing case: the current, unmodified
  // TransitionControls.tsx already attaches this exact `focusOnMount`
  // callback ref to the same "Keep going" Button (see the file's own doc
  // comment: "a manual `.focus()` call on 'Keep going' works immediately
  // once called"), so this assertion already passes before this task's
  // change. It stays in the suite to catch the one thing this task could
  // silently break: dropping the ref, or losing it in translation, while
  // moving this JSX onto the shadcn AlertDialog primitives.
  it('opening the finish-early dialog moves focus to Keep going (the focusOnMount ref must survive the shadcn AlertDialog swap)', async () => {
    const session = makeSession({ version: 5 })
    respond('sessions.get', session)

    const { user } = renderWithProviders(<Harness sessionId={session.id} />)
    await openFinishDialog(user)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep going' }))
  })

  it('the alertdialog carries no retired --color- token', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    const { user } = renderWithProviders(<Harness sessionId={session.id} />)
    await openFinishDialog(user)

    expect(screen.getByRole('alertdialog').className).not.toMatch(/--color-/)
  })
```

Add to `ClockGapPrompt.test.tsx`, inside `describe('ClockGapPrompt', ...)`, right after the existing `'No and Not sure post uncertain and show Timing uncertain'` case:

```tsx
  it('the Timing uncertain chip carries the uncertain tier mark, per absenceTier', async () => {
    const session = makeSession({ id: 'session-tier' })
    respond('sessions.clockGap', { ...session, timerQuality: 'uncertain' })
    const { factory, fire } = makeFakeDetector()
    const { user } = renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

    act(() => fire({ gapSeconds: 90, detectedAtMs: Date.now() }))
    await openAlertDialog()
    await user.click(screen.getByRole('button', { name: 'Not sure' }))

    const chip = await screen.findByText('Timing uncertain')
    expect(chip.closest('[data-tier]')).toHaveAttribute('data-tier', 'uncertain')
  })
```

Add to `AbandonSession.test.tsx`, inside `describe('AbandonSession', ...)`, right after the existing `'renders for running, paused and awaiting_review sessions and not for finalized'` case:

```tsx
  it('the trigger is the shared quiet Button and the reason field is Field-wired, with no retired --color- token', async () => {
    const session = makeSession()
    const { user } = renderWithProviders(<AbandonSession session={session} />)

    expect(screen.getByRole('button', { name: 'Abandon session' })).toHaveAttribute('data-variant', 'quiet')

    await openDialog(user)
    const reason = screen.getByLabelText('Reason (optional)')
    await user.type(reason, 'changed my mind')

    expect(reason).toHaveValue('changed my mind')
    expect(reason.className).not.toMatch(/--color-/)
    expect(screen.getByRole('alertdialog').className).not.toMatch(/--color-/)
  })

  it('the confirm Abandon button carries the destructive-scoped treatment design.md names this action for, not variant=primary', async () => {
    const session = makeSession()
    const { user } = renderWithProviders(<AbandonSession session={session} />)
    await openDialog(user)

    const confirmButton = screen.getByRole('button', { name: 'Abandon' })
    expect(confirmButton).toHaveAttribute('data-variant', 'secondary')
    expect(confirmButton.className).toMatch(/destructive/)
  })
```

the rework spec §3 ("Colour") names "Abandon session" by name as one of the destructive *actions* — alongside "Reset demo data" and "Delete" — that the retained `--destructive` token is scoped to; §6 ("Primitive layer") spells out the mechanism: "destructive confirmations use `variant="secondary"` plus a destructive class" (no fourth `ButtonVariant` value). The dialog's confirm button — the one that actually executes the irreversible abandon, as opposed to the low-key corner trigger that only opens it — is the "destructive confirmation" that sentence describes, so it is the one this task moves off `variant="primary"`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- TransitionControls.test.tsx ClockGapPrompt.test.tsx AbandonSession.test.tsx`
Expected: mostly FAIL, with one already-passing regression guard — `TransitionControls`' new focus case already passes unmodified (see the comment above it: the current `focusOnMount` ref is carried over verbatim, so this is coverage against a future regression, not a case this step turns from red to green); every other new case here is a genuine new failure. The `--color-` assertions fail in all three files because `DIALOG_CONTENT_CLASSES` (or its inlined equivalent) is still applied; `ClockGapPrompt`'s new case fails because "Timing uncertain" is currently a bare text node with no `[data-tier]` ancestor at all; `AbandonSession`'s new cases fail on the missing `data-variant` attribute (the trigger is a raw `AlertDialog.Trigger` today, and the confirm button is `variant="primary"` rather than the destructive-scoped `secondary`) and on the `--color-` match.

- [ ] **Step 3: Implement**

**`TransitionControls.tsx`** — replace the radix import and the two class constants:

```tsx
import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SessionResponseValue, TransitionBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'
import { Button } from '../../ui/Button.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'
```

(delete the `DIALOG_OVERLAY_CLASSES`/`DIALOG_CONTENT_CLASSES` constants entirely — the shadcn `AlertDialogOverlay`/`AlertDialogContent` primitives already carry that look, so the JSX below renders `<AlertDialogOverlay />` bare, with no `className`).

Replace the dialog JSX. Before:

```tsx
        <AlertDialog.Root open={confirmOpen} onOpenChange={handleDialogOpenChange}>
          <AlertDialog.Trigger asChild>
            <Button variant="secondary" disabled={isPending}>
              Finish early
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className={DIALOG_OVERLAY_CLASSES} />
            <AlertDialog.Content className={DIALOG_CONTENT_CLASSES}>
              <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
                Finish this block early?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
                Your recorded time and events stay saved; you&apos;ll review what you completed next.
              </AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  ref={focusOnMount}
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Keep going
                </Button>
                <Button variant="primary" disabled={isPending} onClick={handleFinishConfirm}>
                  Finish now
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
```

After — `@/ui/shadcn/alert-dialog.js` is treated here as a set of decomposed primitives re-exported under shadcn's names (`AlertDialog`/`AlertDialogPortal`/`AlertDialogOverlay`/`AlertDialogContent`/...), the same shape the current `radix-ui` import already has above, rather than a single `AlertDialogContent` that silently bundles its own portal and overlay inside. That choice is what lets `ClockGapPrompt` (below, in this same task) attach `data-testid="clock-gap-overlay"` to a real, addressable overlay element — a wrapper that swallowed the overlay internally would give it nothing to attach that testid to. So `AlertDialogOverlay` is rendered explicitly as a sibling of `AlertDialogContent` here too, exactly mirroring today's `AlertDialog.Overlay` line one-for-one (only the classes on it are dropped, since the shadcn primitive already carries the fixed/dimmed look):

```tsx
        <AlertDialog open={confirmOpen} onOpenChange={handleDialogOpenChange}>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" disabled={isPending}>
              Finish early
            </Button>
          </AlertDialogTrigger>
          <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogContent>
              <AlertDialogTitle>Finish this block early?</AlertDialogTitle>
              <AlertDialogDescription>
                Your recorded time and events stay saved; you&apos;ll review what you completed next.
              </AlertDialogDescription>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  ref={focusOnMount}
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Keep going
                </Button>
                <Button variant="primary" disabled={isPending} onClick={handleFinishConfirm}>
                  Finish now
                </Button>
              </div>
            </AlertDialogContent>
          </AlertDialogPortal>
        </AlertDialog>
```

The `focusOnMount` callback (unchanged, carried verbatim):

```tsx
  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])
```

Also convert the pause label and the error-message paragraph from `text-[var(--color-text-muted)]` to `text-ink-muted` (two one-line swaps in the same file, e.g. `<p role="status" className="text-sm text-ink-muted">Paused</p>`).

**`ClockGapPrompt.tsx`** — replace the import and the dialog/chip JSX. Before:

```tsx
import { AlertDialog } from 'radix-ui'
import type { SessionResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'
import { useClockGap, type CreateGapDetector } from './useClockGap.js'
```

After:

```tsx
import type { SessionResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'
import { Reported } from '../../ui/Reported.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from '../../ui/shadcn/alert-dialog.js'
import { useClockGap, type CreateGapDetector } from './useClockGap.js'
```

Replace the `return` body. Before:

```tsx
  return (
    <>
      <AlertDialog.Root open={open} onOpenChange={() => {}}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay data-testid="clock-gap-overlay" className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg"
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            {/* Outside click/interact are already unconditionally prevented
                inside Radix's own AlertDialogContent (`onPointerDownOutside`/
                `onInteractOutside` are deliberately omitted from its public
                props so a consumer cannot weaken that) — only Escape needs
                suppressing here. */}
            <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
              Did the interval continue uninterrupted?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
              Your device&apos;s clock and the session timer disagreed by more than a minute — this can happen when
              a laptop sleeps or a system clock changes.
            </AlertDialog.Description>

            {errorMessage !== null ? (
              <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2">
              <Button variant="primary" disabled={isPending} onClick={() => void resolve('continued')}>
                Yes, it continued
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                No
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                Not sure
              </Button>
              <Button variant="quiet" disabled={isPending} onClick={() => void resolve('save_incomplete')}>
                Save as incomplete
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {latestSession.timerQuality === 'uncertain' ? (
        <p
          role="status"
          className="fixed bottom-4 left-4 z-40 inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
        >
          Timing uncertain
        </p>
      ) : null}

      {latestSession.timing.remainingSeconds <= 0 ? (
        <p role="status" className="fixed bottom-4 left-32 z-40 text-xs text-[var(--color-text-muted)]">
          Awaiting review
        </p>
      ) : null}
    </>
  )
}
```

After — `AlertDialogOverlay` is rendered explicitly here too (same decomposed-primitives shape as `TransitionControls`/`AbandonSession` above and below), carrying the `data-testid="clock-gap-overlay"` the existing `'Escape and outside click do not close the dialog'` case reads via `screen.getByTestId('clock-gap-overlay')` — the one place in this task that testid actually matters, which is why this file's own header comment calls it out. Everything else about outside-click/Escape suppression is unchanged, since it lives on the underlying Radix primitive shadcn's wrapper still forwards `onEscapeKeyDown` to:

```tsx
  return (
    <>
      <AlertDialog open={open} onOpenChange={() => {}}>
        <AlertDialogPortal>
          <AlertDialogOverlay data-testid="clock-gap-overlay" />
          <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
            {/* Outside click/interact are already unconditionally prevented
                inside Radix's own AlertDialogContent (`onPointerDownOutside`/
                `onInteractOutside` are deliberately omitted from its public
                props so a consumer cannot weaken that) — only Escape needs
                suppressing here. */}
            <AlertDialogTitle>Did the interval continue uninterrupted?</AlertDialogTitle>
            <AlertDialogDescription>
              Your device&apos;s clock and the session timer disagreed by more than a minute — this can happen when
              a laptop sleeps or a system clock changes.
            </AlertDialogDescription>

            {errorMessage !== null ? (
              <p role="alert" className="mt-3 text-sm text-ink-muted">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2">
              <Button variant="primary" disabled={isPending} onClick={() => void resolve('continued')}>
                Yes, it continued
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                No
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                Not sure
              </Button>
              <Button variant="quiet" disabled={isPending} onClick={() => void resolve('save_incomplete')}>
                Save as incomplete
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>

      {latestSession.timerQuality === 'uncertain' ? (
        <p role="status" className="fixed bottom-4 left-4 z-40 inline-block rounded-full border border-rule bg-card px-2 py-0.5 text-xs">
          <Reported>Timing uncertain</Reported>
        </p>
      ) : null}

      {latestSession.timing.remainingSeconds <= 0 ? (
        <p role="status" className="fixed bottom-4 left-32 z-40 text-xs text-ink-muted">
          Awaiting review
        </p>
      ) : null}
    </>
  )
}
```

**`AbandonSession.tsx`** — replace the import and the dialog JSX. Before:

```tsx
import { useEffect, useId, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useAbandonSession } from './useAbandonSession.js'
```

After:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { useAbandonSession } from './useAbandonSession.js'
```

Inside the component, replace the manual `useId()` reason id with `useField`. Before:

```tsx
  const { abandon, status } = useAbandonSession(session.id)
  const reasonInputId = useId()
```

After:

```tsx
  const { abandon, status } = useAbandonSession(session.id)
  const reasonField = useField({ name: 'abandon-reason' })
```

Replace the render body's trigger and dialog. Before:

```tsx
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Trigger className="fixed bottom-4 right-4 z-40 inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-xs font-medium text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-[var(--color-surface)]">
        Abandon session
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
          <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
            Abandon this session?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
            Unsent entries on this device will be discarded; the attempt stays in your record as abandoned.
          </AlertDialog.Description>

          <div className="mt-4 space-y-1">
            <label htmlFor={reasonInputId} className="block text-sm font-medium text-[var(--color-text)]">
              Reason (optional)
            </label>
            <input
              id={reasonInputId}
              type="text"
              value={reason}
              maxLength={REASON_MAX_LENGTH}
              disabled={isPending}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {status === 'stale' ? (
            <p role="status" className="mt-3 text-sm text-[var(--color-text-muted)]">
              This session was updated in another tab
            </p>
          ) : null}
          {status === 'error' ? (
            <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
              Could not abandon. Retry.
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" disabled={isPending} onClick={() => handleOpenChange(false)}>
              Keep session
            </Button>
            <Button variant="primary" disabled={isPending} onClick={handleConfirm}>
              Abandon
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
```

After:

```tsx
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="quiet" className="fixed bottom-4 right-4 z-40">
          Abandon session
        </Button>
      </AlertDialogTrigger>
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogContent>
          <AlertDialogTitle>Abandon this session?</AlertDialogTitle>
          <AlertDialogDescription>
            Unsent entries on this device will be discarded; the attempt stays in your record as abandoned.
          </AlertDialogDescription>

          <div className="mt-4 space-y-1">
            <Label {...reasonField.labelProps}>Reason (optional)</Label>
            <Input
              {...reasonField.controlProps}
              type="text"
              value={reason}
              maxLength={REASON_MAX_LENGTH}
              disabled={isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {status === 'stale' ? (
            <p role="status" className="mt-3 text-sm text-ink-muted">
              This session was updated in another tab
            </p>
          ) : null}
          {status === 'error' ? (
            <p role="alert" className="mt-3 text-sm text-ink-muted">
              Could not abandon. Retry.
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" disabled={isPending} onClick={() => handleOpenChange(false)}>
              Keep session
            </Button>
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={handleConfirm}
              className="border-destructive text-destructive hover:bg-destructive/10"
            >
              Abandon
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialog>
  )
}
```

(`variant="primary"` -> `variant="secondary"` plus the destructive-scoped `className` on this one button only — everything else in this block, including `Keep session`, is unchanged. `ButtonVariant` still stays the closed `primary | secondary | quiet` union per the rework spec §6; the destructive look layers on as an extra class the same way `Button`'s own `className` prop already merges any caller-supplied class today.)

(`Button`'s frozen contract keeps `min-h-11 min-w-11` and `type="button"` on every variant including `quiet`, so the trigger keeps its 44px hit target without restating it. The trigger's `fixed bottom-4 right-4 z-40` positioning is passed as `Button`'s own `className` prop, same as it is today (`apps/web/src/ui/Button.tsx`'s current `['...', className].filter(Boolean).join(' ')` already appends any caller-supplied `className` after its variant classes) — this task depends on Wave 0's rebuilt `Button` continuing to accept and merge an incoming `className` the same way, whatever internal merge utility (`cn()` or otherwise) that rebuild ends up using; Wave 0 owns `Button.tsx`, so this task does not re-verify its internals.)

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- TransitionControls.test.tsx ClockGapPrompt.test.tsx AbandonSession.test.tsx`
Expected: PASS — every pre-existing case in all three files keeps passing unmodified, in particular: `TransitionControls.test.tsx`'s `'exactly one primary-styled control...'` (still exactly one `[data-variant="primary"]` — the dialog's own primary "Finish now" is outside `container` because Radix still portals `AlertDialogContent` to `document.body`, and `AbandonSession`'s confirm button no longer being `primary` at all only widens that margin); `ClockGapPrompt.test.tsx`'s `'Escape and outside click do not close the dialog'` (the overlay `data-testid` and the `onEscapeKeyDown` prevention are both still forwarded); `AbandonSession.test.tsx`'s `'renders for running, paused and awaiting_review... and not for finalized'`, the `'nothing is posted without confirmation...'` case (`confirm(user)` still finds a button named `'Abandon'` — the variant/className change never touches its accessible name), and the two 409-stale cases (role/name queries, unaffected by the internal chrome swap). The two new cases from Step 1 pass for the first time: the trigger's `data-variant="quiet"` and the confirm button's `data-variant="secondary"` plus its `destructive`-matching `className`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/focus/TransitionControls.tsx apps/web/src/features/focus/ClockGapPrompt.tsx apps/web/src/features/focus/AbandonSession.tsx apps/web/src/features/focus/TransitionControls.test.tsx apps/web/src/features/focus/ClockGapPrompt.test.tsx apps/web/src/features/focus/AbandonSession.test.tsx
git commit -m "Focus: consolidate TransitionControls/ClockGapPrompt/AbandonSession onto the one shadcn AlertDialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u"
```

---

## Unit: Daily check-in

### Task 38: `DeviceMinutesField.tsx` onto shadcn `Input` + `useField`, with an associated error and the petrol "computed" rule

The phone/desktop headline field is the one place in this unit where a value can become
server-computed and needs a visible "this is now live" mark (the rework spec §8, "Daily check-in": *"A
headline field superseded by its own detail rows keeps its recorded number but gains a thin petrol
rule, because it is the one value on screen being computed live from what was just logged below."*).
This task also gives this field a real `aria-describedby` link it does not have today: the
`feed_platform_conflict` message CheckinForm renders next to it is currently an unassociated sibling
`<p role="alert">` with no `id`, so nothing points `aria-describedby` at it. This is the same *class*
of gap as the rework spec §9 defect #2 ("Character counters are not associated with their fields"), but not
that defect itself — defect #2 names five specific character-counter fields (recall points,
disruption note, review note, replacement reason, output note), none of which is this one. The fix
here is independent, using the same `useField` wiring the `Field` component is built on.

**Files:**
- Modify: `apps/web/src/features/checkin/DeviceMinutesField.tsx`
- Modify: `apps/web/src/features/checkin/CheckinForm.tsx` (only the two `<DeviceMinutesField>` call
  sites and their now-redundant adjacent error paragraphs — the rest of this file is Task 39)
- Test: `apps/web/src/features/checkin/CheckinForm.test.tsx` (no separate `DeviceMinutesField.test.tsx`
  exists; this component is exercised only through `CheckinForm`, per the file's own existing tests)

**Interfaces:**
- Consumes (frozen, Wave 0): `cn` from `@/lib/cn.js` → `apps/web/src/lib/cn.js`; `useField` from
  `@/ui/field.js` → `apps/web/src/ui/field.js`; `Input` from `@/ui/shadcn/input.js`; `Label` from
  `@/ui/shadcn/label.js`
- Produces: `DeviceMinutesFieldProps` gains `readonly error?: string | null | undefined`. This task's
  own `CheckinForm.tsx` edit (Step 3 below) is what wires it: it already passes `fieldErrors.phone` /
  `fieldErrors.desktop` into the two call sites and deletes the duplicate `<p role="alert">` blocks
  that used to sit beside them. Task 39 touches neither those two call sites nor their error paths
  again — it only consumes the fact that the wiring already exists.

- [ ] **Step 1: Write the failing test**

Extend two existing tests in `CheckinForm.test.tsx` — do not add a new describe block.

```tsx
// Replace the body of the existing test
// 'adding a desktop detail row disables the desktop headline input and shows the summed total'
// (same setup as today; only the new final line is added):
  it('adding a desktop detail row disables the desktop headline input and shows the summed total', async () => {
    const desktopDetailRow: FeedRowValue = {
      device: 'desktop',
      platform: 'Chrome',
      minutes: 20,
      shortVideoMinutes: null,
      measurementScope: 'feed',
      source: 'estimate',
      plannedWindow: null,
    }
    mount(OPEN_PROGRAM, dayFixture({ feed: [desktopDetailRow], status: 'incomplete', missing: ['sleep'], version: 3 }))

    await screen.findByLabelText('Sleep minutes')
    const desktopInput = screen.getByLabelText('Desktop feed minutes')
    expect(desktopInput).toBeDisabled()
    expect(desktopInput).toHaveValue(20)
    expect(screen.getByText('Desktop: 20 min')).toBeInTheDocument()
    expect(desktopInput).toHaveClass('border-b-signal')
  })

// Replace the body of the existing test
// '422 feed_platform_conflict renders on the phone headline field and blocks Save'
// (only the new line after the existing findByText is added):
  it('422 feed_platform_conflict renders on the phone headline field and blocks Save', async () => {
    const { user, router } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '10')
    reject('days.put', {
      status: 422,
      code: 'feed_platform_conflict',
      fieldErrors: { 'feed[0].platform': ['device has both an all row and platform rows'] },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Clear this total or remove the detail rows below')
    expect(screen.getByLabelText('Phone feed minutes')).toHaveAccessibleDescription(
      'Clear this total or remove the detail rows below',
    )
    expect(router.state.location.pathname).toBe(`/checkin/${DATE}`)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- CheckinForm`
Expected: FAIL — two independent single-assertion failures, one per test. In the desktop-disable
test, `expect(desktopInput).toHaveClass('border-b-signal')` fails because the native `<input>` carries
no such class today. In the 422-conflict test, `toHaveAccessibleDescription('Clear this total or
remove the detail rows below')` fails because the message renders as a sibling `<p role="alert">` in
`CheckinForm.tsx` with no `id`, so nothing points `aria-describedby` at it — the input's accessible
description is empty.

- [ ] **Step 3: Implement**

Full replacement of `apps/web/src/features/checkin/DeviceMinutesField.tsx`:

```tsx
/**
 * One headline device-minutes input for CheckinForm (task 8.7.1; design.md
 * D36; shadcn-ui-rework the rework spec §8 "Daily check-in"). Renders exactly one
 * number field for `device`. When `disabled` is true (a detail row already
 * exists for this device, per D36's mutual-exclusivity rule) the field
 * becomes a read-only display of `value` — the caller passes the
 * already-summed feed-scope total in that case, never an editable draft —
 * and gains a thin `signal` (petrol) rule along its bottom edge, because it
 * is now a value being computed live from the detail rows below it rather
 * than a plain entry.
 *
 * All-blank-by-default: `value === null` renders an empty input, never `0`
 * (CLAUDE.md "Unknown != zero" — a blank box is not-reported, not a zero
 * reading).
 *
 * `error`, when present, is a server-reported conflict (CheckinForm.tsx's
 * `feed_platform_conflict` handling) wired through `useField` so it is both
 * visible and associated to the input via `aria-describedby` — an
 * unassociated-error gap of the same kind as the rework spec §9 defect 2, though
 * this field is not one of that defect's five named fields (see this file's
 * header comment above and the CheckinForm.tsx task header for the
 * distinction).
 */
import type { ChangeEvent } from 'react'

import { cn } from '../../lib/cn.js'
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

export type HeadlineDevice = 'phone' | 'desktop'

export interface DeviceMinutesFieldProps {
  readonly device: HeadlineDevice
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly disabled: boolean
  readonly error?: string | null | undefined
}

const DEVICE_LABEL: Record<HeadlineDevice, string> = {
  phone: 'Phone feed minutes',
  desktop: 'Desktop feed minutes',
}

/** Rejects a keystroke that would make the value negative or non-integer; blank always passes through as `null`. */
function parseNonNegativeInteger(raw: string): number | null | undefined {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

export function DeviceMinutesField({ device, value, onChange, disabled, error }: DeviceMinutesFieldProps) {
  const label = DEVICE_LABEL[device]
  const field = useField({ name: `checkin-${device}-minutes`, error })

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = parseNonNegativeInteger(event.target.value)
    if (next === undefined) return
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <Label {...field.labelProps}>{label}</Label>
      <Input
        {...field.controlProps}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        disabled={disabled}
        aria-readonly={disabled}
        value={value === null ? '' : value}
        onChange={handleChange}
        className={cn('min-h-11 w-full max-w-40', disabled && 'border-b-2 border-b-signal')}
      />
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm text-ink">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

In `apps/web/src/features/checkin/CheckinForm.tsx`, change only the two field blocks (leave
everything else — the summary `<p>` lines, the sleep field, the Collapsible, imports — untouched;
that is Task 39):

```tsx
// Before:
      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="phone"
          value={effectivePhone}
          disabled={disabled.phone}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'phone', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Phone: {deviceSummaryText(effectivePhone)}</p>
        {fieldErrors.phone !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.phone}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="desktop"
          value={effectiveDesktop}
          disabled={disabled.desktop}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'desktop', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Desktop: {deviceSummaryText(effectiveDesktop)}</p>
        {fieldErrors.desktop !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.desktop}
          </p>
        ) : null}
      </div>

// After:
      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="phone"
          value={effectivePhone}
          disabled={disabled.phone}
          error={fieldErrors.phone}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'phone', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Phone: {deviceSummaryText(effectivePhone)}</p>
      </div>

      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="desktop"
          value={effectiveDesktop}
          disabled={disabled.desktop}
          error={fieldErrors.desktop}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'desktop', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Desktop: {deviceSummaryText(effectiveDesktop)}</p>
      </div>
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- CheckinForm`
Expected: PASS — all 14 existing cases plus the two new assertions.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/checkin/DeviceMinutesField.tsx apps/web/src/features/checkin/CheckinForm.tsx apps/web/src/features/checkin/CheckinForm.test.tsx
git commit -m "$(cat <<'EOF'
Move DeviceMinutesField onto shadcn Input/useField

Gives the headline phone/desktop field a real aria-describedby link to a
feed_platform_conflict error instead of an unassociated sibling paragraph,
and marks a field superseded by its own detail rows with a thin petrol rule
along its bottom edge, per the shadcn-ui-rework design's "Daily check-in"
section.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 39: `CheckinForm.tsx` — sleep field, Collapsible trigger, stale-version alert and the Reported summary lines

Everything else in `CheckinForm.tsx`: the sleep number field onto `Input`/`Label`/`useField`; the
raw `radix-ui` `Collapsible` import replaced with the shadcn `collapsible` primitive (this is one of
the "eleven files importing `radix-ui` directly" design.md calls out); the stale-version notice onto
`Alert`; the save-error paragraph off literal red; and the "Phone: …" / "Desktop: …" summary lines
wrapped in `<Reported>` so `Not reported` gets the not-a-value tier instead of just being muted body
text indistinguishable from every other secondary line. Also folds in `CheckinStatus.tsx`, a
two-line token-only change.

**Files:**
- Modify: `apps/web/src/features/checkin/CheckinForm.tsx`
- Modify: `apps/web/src/features/checkin/CheckinStatus.tsx`
- Test: `apps/web/src/features/checkin/CheckinForm.test.tsx`

**Interfaces:**
- Consumes (frozen, Wave 0): `useField` from `@/ui/field.js`; `Input`, `Label` from
  `@/ui/shadcn/input.js` / `@/ui/shadcn/label.js`; `Collapsible`, `CollapsibleContent`,
  `CollapsibleTrigger` from `@/ui/shadcn/collapsible.js`; `Alert`, `AlertDescription` from
  `@/ui/shadcn/alert.js`; `Reported` (`{ children: string }`) from `@/ui/Reported.js`; `Button` from
  `@/ui/Button.js` (unchanged import; still a plain, prop-for-prop identical `Button` — it does not
  receive `asChild` here. The one `asChild` in this task belongs to `CollapsibleTrigger`, which wraps
  this `Button` as its child so Radix's trigger behavior attaches to the real `<button>` element
  instead of adding a second one.)
- Consumes (Task 38): `DeviceMinutesFieldProps.error` — already wired by Task 38, untouched here
- Produces: `data-testid="phone-feed-summary"` / `data-testid="desktop-feed-summary"` — introduced
  only so this task's own tests can assert on text that now spans two DOM nodes (a plain "Phone:"
  label plus a `<Reported>` value); no other unit consumes them.

- [ ] **Step 1: Write the failing test**

Three edits to `CheckinForm.test.tsx`. First, the two device-summary assertions move from `getByText`
(exact whole-string match against one node's own direct text) to `getByTestId` + `toHaveTextContent`
(matches concatenated `textContent`, which is required once the value is a nested `<Reported>` span):

```tsx
// In 'blank phone sends no phone row and the summary shows phone Not reported', replace:
    expect(screen.getByText('Phone: Not reported')).toBeInTheDocument()
// with:
    expect(screen.getByTestId('phone-feed-summary')).toHaveTextContent('Phone: Not reported')

// In 'explicit phone 0 sends a row with minutes 0 and the summary shows 0 min, not Not reported', replace:
    await user.type(screen.getByLabelText('Phone feed minutes'), '0')
    expect(screen.getByText('Phone: 0 min')).toBeInTheDocument()
    expect(screen.queryByText('Phone: Not reported')).not.toBeInTheDocument()
// with:
    await user.type(screen.getByLabelText('Phone feed minutes'), '0')
    expect(screen.getByTestId('phone-feed-summary')).toHaveTextContent('Phone: 0 min')
    expect(screen.getByTestId('phone-feed-summary')).not.toHaveTextContent('Not reported')

// In 'adding a desktop detail row disables the desktop headline input and shows the summed total'
// (Task 38 already added the border-b-signal line to this test), replace:
    expect(screen.getByText('Desktop: 20 min')).toBeInTheDocument()
// with:
    expect(screen.getByTestId('desktop-feed-summary')).toHaveTextContent('Desktop: 20 min')
```

Second, add a role check to the existing stale-notice test, right after its first `findByText`:

```tsx
// In 'stale 409 replaces the form with the returned current values and offers Re-apply my values',
// after:
    await screen.findByText('This check-in was updated elsewhere; showing the current values')
// add:
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in was updated elsewhere; showing the current values')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- CheckinForm`
Expected: FAIL — three `getByTestId('phone-feed-summary')` / `getByTestId('desktop-feed-summary')`
calls throw `Unable to find an element by: [data-testid="phone-feed-summary"]` (and the desktop
equivalent) because the plain `<p>` in `CheckinForm.tsx` carries no `data-testid` yet. The
`getByRole('alert')` line already passes today (the stale notice is already a `role="alert"` div), so
it does not itself contribute to the failure, but the run as a whole is red on the testid assertions.

- [ ] **Step 3: Implement**

Imports at the top of `CheckinForm.tsx` — replace:

```tsx
import { Collapsible } from 'radix-ui'
```

with:

```tsx
import { useField } from '../../ui/field.js'
import { Alert, AlertDescription } from '../../ui/shadcn/alert.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/shadcn/collapsible.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { Reported } from '../../ui/Reported.js'
```

Add the `useField` call unconditionally alongside the other `useState` calls (before any early
`return`, to satisfy the Rules of Hooks) — insert right after the existing `staleNotice` state:

```tsx
  const [staleNotice, setStaleNotice] = useState<{ readonly draft: CheckinFormState } | null>(null)
  const sleepField = useField({ name: 'checkin-sleep', error: fieldErrors.sleep })
```

Replace the stale-notice block:

```tsx
// Before:
      {staleNotice !== null ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          <p>This check-in was updated elsewhere; showing the current values</p>
          <Button type="button" variant="secondary" onClick={handleReapplyMyValues}>
            Re-apply my values
          </Button>
        </div>
      ) : null}

// After:
      {staleNotice !== null ? (
        <Alert className="flex flex-col gap-2">
          <AlertDescription>This check-in was updated elsewhere; showing the current values</AlertDescription>
          <Button type="button" variant="secondary" onClick={handleReapplyMyValues}>
            Re-apply my values
          </Button>
        </Alert>
      ) : null}
```

Replace the sleep field:

```tsx
// Before:
      <div className="flex flex-col gap-1">
        <label htmlFor="checkin-sleep" className="text-sm font-medium text-[var(--color-text)]">
          Sleep minutes
        </label>
        <input
          id="checkin-sleep"
          name="checkin-sleep"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          step={1}
          value={state.sleepMinutes === null ? '' : state.sleepMinutes}
          onChange={(event) => {
            const raw = event.target.value
            if (raw.trim() === '') {
              dispatch({ type: 'setSleep', value: null })
              return
            }
            const parsed = Number(raw)
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) return
            dispatch({ type: 'setSleep', value: parsed })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {fieldErrors.sleep !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.sleep}
          </p>
        ) : null}
      </div>

// After:
      <div className="flex flex-col gap-1">
        <Label {...sleepField.labelProps}>Sleep minutes</Label>
        <Input
          {...sleepField.controlProps}
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          step={1}
          value={state.sleepMinutes === null ? '' : state.sleepMinutes}
          onChange={(event) => {
            const raw = event.target.value
            if (raw.trim() === '') {
              dispatch({ type: 'setSleep', value: null })
              return
            }
            const parsed = Number(raw)
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) return
            dispatch({ type: 'setSleep', value: parsed })
          }}
          className="min-h-11 w-full max-w-40"
        />
        {sleepField.errorProps !== undefined ? (
          <p {...sleepField.errorProps} className="text-sm text-ink">
            {fieldErrors.sleep}
          </p>
        ) : null}
      </div>
```

Replace the two summary lines (from Task 38's already-updated block, only these `<p>` tags change):

```tsx
// Before:
        <p className="text-sm text-[var(--color-text-muted)]">Phone: {deviceSummaryText(effectivePhone)}</p>
// After:
        <p className="text-sm text-ink-muted" data-testid="phone-feed-summary">
          Phone: <Reported>{deviceSummaryText(effectivePhone)}</Reported>
        </p>

// Before:
        <p className="text-sm text-[var(--color-text-muted)]">Desktop: {deviceSummaryText(effectiveDesktop)}</p>
// After:
        <p className="text-sm text-ink-muted" data-testid="desktop-feed-summary">
          Desktop: <Reported>{deviceSummaryText(effectiveDesktop)}</Reported>
        </p>
```

Replace the Collapsible block:

```tsx
// Before:
      <Collapsible.Root>
        <Collapsible.Trigger
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-transparent px-4 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
        >
          More detail
        </Collapsible.Trigger>
        <Collapsible.Content className="flex flex-col gap-6 pt-2">

// After:
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="quiet">
            More detail
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-6 pt-2">
```

and its closing tags:

```tsx
// Before:
        </Collapsible.Content>
      </Collapsible.Root>

// After:
        </CollapsibleContent>
      </Collapsible>
```

Replace the save-error paragraph's class only:

```tsx
// Before:
      {saveError !== null ? (
        <p role="alert" className="text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

// After:
      {saveError !== null ? (
        <p role="alert" className="text-sm text-ink">
          {saveError}
        </p>
      ) : null}
```

Full replacement of `apps/web/src/features/checkin/CheckinStatus.tsx`:

```tsx
/**
 * Renders a day's completeness verbatim from the server (task 8.7.1; D12/D36;
 * CLAUDE.md "Unknown != zero" and "never inferred from record existence").
 * `status`/`missing` always come straight from a `GET`/`PUT
 * /programs/{id}/days/{date}` response's own `status` object — this
 * component performs no completeness computation of its own.
 */
import type { CheckinField, CheckinStatus as CheckinStatusValue } from '@attention-lab/shared'

export interface CheckinStatusProps {
  readonly status: CheckinStatusValue
  readonly missing: readonly CheckinField[]
}

const FIELD_LABEL: Record<CheckinField, string> = {
  sleep: 'sleep',
  feed: 'feed',
}

export function CheckinStatus({ status, missing }: CheckinStatusProps) {
  const text =
    status === 'complete'
      ? 'Complete'
      : `Incomplete — missing: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`

  return (
    <p role="status" className="text-sm font-medium text-ink">
      {text}
    </p>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- CheckinForm`
Expected: PASS — all 14 original cases, Task 38's two additions, and this task's testid/role
assertions.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/checkin/CheckinForm.tsx apps/web/src/features/checkin/CheckinStatus.tsx apps/web/src/features/checkin/CheckinForm.test.tsx
git commit -m "$(cat <<'EOF'
Rework CheckinForm chrome onto shadcn primitives and the Reported taxonomy

Sleep field onto Input/Label/useField; the raw radix-ui Collapsible import
onto the shadcn collapsible primitive; the stale-version notice onto Alert;
literal red on the save error replaced with ink text, matching every other
validation and error message in this unit; and the phone/desktop summary
lines now wrap their value in <Reported> so an unreported device gets the
not-a-value tier instead of unmarked muted text.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 40: `FeedRows.tsx` — per-row Device select, inputs, measurement-scope radios and checkboxes onto shadcn

The largest single change in this unit: `FeedRow`'s native `<select>`, three `<input>`s, two radio
buttons and two checkboxes all move onto shadcn primitives, wired through `useField` wherever an
error can attach. Converting the Device control from a native `<select>` to a Radix-backed `Select`
changes how it must be driven in tests — `userEvent.selectOptions` only targets a native `<select>`
or an element with `role="listbox"`, neither of which a Radix `Select.Trigger` is — so the two tests
that drive it are rewritten to open the trigger and click the option, which is also why this task
adds two jsdom pointer-capture/scroll stubs Radix's popover positioning calls but jsdom 29.1.1 does
not implement.

**Files:**
- Modify: `apps/web/src/features/checkin/FeedRows.tsx` (the `FeedRow` function and its imports only —
  `OptionalFields` is Task 41)
- Test: `apps/web/src/features/checkin/FeedRows.test.tsx`

**Interfaces:**
- Consumes (frozen, Wave 0): `useField` from `@/ui/field.js`; `Checkbox` from
  `@/ui/shadcn/checkbox.js`; `Input` from `@/ui/shadcn/input.js`; `Label` from `@/ui/shadcn/label.js`;
  `RadioGroup`, `RadioGroupItem` from `@/ui/shadcn/radio-group.js`; `Select`, `SelectContent`,
  `SelectItem`, `SelectTrigger`, `SelectValue` from `@/ui/shadcn/select.js`
- Produces: nothing — leaf task. `FeedRowDraft`, `FeedRowFieldErrors`, `sendableDetailRow`,
  `toFeedRowInput`, `toDraftRow`, `validateDetailRows` and every other exported helper in this file
  are unchanged; only `FeedRow`'s internal markup changes.

- [ ] **Step 1: Write the failing test**

Add jsdom stubs at the top of `FeedRows.test.tsx`, right after the imports (before `const PROGRAM_ID
= ...`):

```tsx
// Radix's Select positions its portalled listbox using pointer-capture and
// scroll APIs jsdom 29.1.1 does not implement; stub them so opening the
// Device select below does not throw. Guarded, matching src/test/setup.ts's
// own style, in case a future jsdom ships real implementations.
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
}
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {}
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = () => {}
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
```

Replace the two `selectOptions` interactions with an open-then-choose interaction. First, in `'phone
20 + desktop 20 reads 40 device-minutes and not 40 minutes'`:

```tsx
// Before:
    const group2 = await addRow(user, 2)
    await user.selectOptions(within(group2).getByLabelText('Device'), 'desktop')
    await user.type(within(group2).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group2).getByLabelText('Minutes'), '20')

// After:
    const group2 = await addRow(user, 2)
    await user.click(within(group2).getByLabelText('Device'))
    await user.click(await screen.findByRole('option', { name: 'Desktop' }))
    await user.type(within(group2).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group2).getByLabelText('Minutes'), '20')
```

Second, in `'phone 0 + desktop 20 reads 20 device-minutes without the partial label; desktop 20 with
no phone row of any kind is labelled partial'`:

```tsx
// Before:
    const group = await addRow(user, 1)
    await user.selectOptions(within(group).getByLabelText('Device'), 'desktop')
    await user.type(within(group).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group).getByLabelText('Minutes'), '20')

// After:
    const group = await addRow(user, 1)
    await user.click(within(group).getByLabelText('Device'))
    await user.click(await screen.findByRole('option', { name: 'Desktop' }))
    await user.type(within(group).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group).getByLabelText('Minutes'), '20')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- FeedRows`
Expected: FAIL — `user.click(within(group2).getByLabelText('Device'))` finds the native `<select>`,
but `screen.findByRole('option', { name: 'Desktop' })` times out: clicking a native `<select>` does
not open a popover in jsdom, so no `role="option"` element for "Desktop" becomes reachable the way
the test expects, and the row never receives `device: 'desktop'`, so the later `within(group2)`
lookups for "Chrome"/"20" land on the wrong row's assertions downstream.

- [ ] **Step 3: Implement**

Imports at the top of `FeedRows.tsx` — add alongside the existing ones:

```tsx
import { useField } from '../../ui/field.js'
import { Checkbox } from '../../ui/shadcn/checkbox.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/shadcn/select.js'
```

Full replacement of the `FeedRow` function:

```tsx
function FeedRow({ index, row, errors, onChange, onRemove }: FeedRowProps) {
  const idBase = `feedrow-${index}`

  function patch(next: Partial<FeedRowDraft>): void {
    onChange({ ...row, ...next })
  }

  const deviceField = useField({ name: `${idBase}-device` })
  const platformField = useField({ name: `${idBase}-platform`, error: errors?.platform })
  const minutesField = useField({ name: `${idBase}-minutes` })
  const shortVideoField = useField({ name: `${idBase}-shortvideo`, error: errors?.shortVideoMinutes })

  return (
    <div role="group" aria-label={`Feed detail row ${index + 1}`} className="flex flex-col gap-2 rounded-md border border-rule p-3">
      {errors?.row !== undefined ? (
        <p role="alert" className="text-sm text-ink">
          {errors.row}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label {...deviceField.labelProps}>Device</Label>
        <Select value={row.device} onValueChange={(value) => patch({ device: value as FeedDevice })}>
          <SelectTrigger {...deviceField.controlProps} className="min-h-11 w-full max-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FEED_DEVICES.map((device) => (
              <SelectItem key={device} value={device}>
                {DEVICE_LABEL[device]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label {...platformField.labelProps}>Platform</Label>
        <Input
          {...platformField.controlProps}
          type="text"
          value={row.platform}
          onChange={(event) => patch({ platform: event.target.value })}
          className="min-h-11 w-full max-w-60"
        />
        {platformField.errorProps !== undefined ? (
          <p {...platformField.errorProps} className="text-sm text-ink">
            {errors?.platform}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label {...minutesField.labelProps}>Minutes</Label>
        <Input
          {...minutesField.controlProps}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={row.minutes === null ? '' : row.minutes}
          onChange={(event) => {
            const next = parseOptionalNonNegativeInteger(event.target.value)
            if (next === undefined) return
            patch({ minutes: next })
          }}
          className="min-h-11 w-full max-w-40"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label {...shortVideoField.labelProps}>Short-video minutes</Label>
        <Input
          {...shortVideoField.controlProps}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={row.shortVideoMinutes === null ? '' : row.shortVideoMinutes}
          onChange={(event) => {
            const next = parseOptionalNonNegativeInteger(event.target.value)
            if (next === undefined) return
            patch({ shortVideoMinutes: next })
          }}
          className="min-h-11 w-full max-w-40"
        />
        {shortVideoField.errorProps !== undefined ? (
          <p {...shortVideoField.errorProps} className="text-sm text-ink">
            {errors?.shortVideoMinutes}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-ink">Measurement scope</legend>
        <RadioGroup
          value={row.measurementScope}
          onValueChange={(value) => patch({ measurementScope: value as MeasurementScope })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="feed" id={`${idBase}-scope-feed`} />
            <Label htmlFor={`${idBase}-scope-feed`} className="text-sm text-ink">
              Feed only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="app_total" id={`${idBase}-scope-app`} />
            <Label htmlFor={`${idBase}-scope-app`} className="text-sm text-ink">
              Whole app
            </Label>
          </div>
        </RadioGroup>
      </fieldset>

      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idBase}-device-report`}
          checked={row.source === 'device_report'}
          onCheckedChange={(checked) => patch({ source: checked === true ? 'device_report' : 'estimate' })}
        />
        <Label htmlFor={`${idBase}-device-report`} className="text-sm text-ink">
          From device report
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idBase}-planned-window`}
          checked={row.plannedWindow === true}
          onCheckedChange={(checked) => patch({ plannedWindow: checked === true ? true : null })}
        />
        <Label htmlFor={`${idBase}-planned-window`} className="text-sm text-ink">
          Planned window
        </Label>
      </div>

      <Button type="button" variant="secondary" onClick={onRemove}>
        Remove row
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- FeedRows`
Expected: PASS — all 11 cases, including both rewritten Device-select interactions and the existing
checkbox/radio/error-mapping cases (`'From device report sends source device_report...'`, `'platform
all on a detail row is rejected inline...'`, `'server 422 subset maps to the row short-video
field'`).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/checkin/FeedRows.tsx apps/web/src/features/checkin/FeedRows.test.tsx
git commit -m "$(cat <<'EOF'
Move FeedRow's controls onto shadcn Select/Input/RadioGroup/Checkbox

Converts the per-row Device select, Platform/Minutes/Short-video inputs,
Measurement-scope radios and the two checkboxes onto shadcn primitives wired
through useField, and updates the Device-select tests to open-then-choose
since a Radix Select trigger cannot be driven with userEvent.selectOptions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 41: `OptionalFields` onto shadcn `Input`/`Textarea` and the `FeedTotals.tsx` middle-dot fix

Closes out the unit: the stress/mindfulness/note fields inside `FeedRows.tsx`'s `OptionalFields`
move onto shadcn `Input`/`Textarea`/`useField` (closing the same *class* of unassociated-error-message
gap fixed for the headline device fields in Task 38, this time for `STRESS_RANGE_MESSAGE`; design.md
§9 defect #2 is a related but distinct fix, naming five other, different character-counter fields —
recall points, disruption note, review note, replacement reason, output note — that this unit does
not touch), and `FeedTotals.tsx` loses the banned middle-dot meta string (the rework spec §4: `" ·
Partial — a report is missing for phone or desktop"`), replaced with a plain clause, plus a
token-only pass over its remaining classes. The visible replacement wording is not pinned in any
test (the rework spec §4 says so explicitly), and the partial notice stays nested under exactly the
condition it was under before — it does not appear until there is already a total for it to qualify.
Nothing here frames feed minutes as a score to minimise — the partial notice states a data-completeness
fact, not a judgment.

**Files:**
- Modify: `apps/web/src/features/checkin/FeedRows.tsx` (the `OptionalFields` function only)
- Modify: `apps/web/src/features/checkin/FeedTotals.tsx`
- Test: `apps/web/src/features/checkin/FeedRows.test.tsx`

**Interfaces:**
- Consumes (frozen, Wave 0): `useField` from `@/ui/field.js`; `Input` from `@/ui/shadcn/input.js`;
  `Label` from `@/ui/shadcn/label.js`; `Textarea` from `@/ui/shadcn/textarea.js`
- Produces: nothing — leaf task. `FeedTotalsProps`, `OptionalFieldsProps`, `OptionalFieldsValue` are
  unchanged.

- [ ] **Step 1: Write the failing test**

Add an accessible-description assertion to the existing stress-validation test, and add one new test
for the rewritten partial notice. The new test deliberately does **not** assert the exact replacement
wording (the rework spec §4 says the visible string is not asserted by any test); it reuses the same
`/partial/i` pattern the rest of this file already uses, and separately asserts the middle-dot
character is gone.

```tsx
// In 'blank stress, mindfulness and note are omitted from the body and stress 11 is rejected inline',
// after:
    await user.type(screen.getByLabelText('Stress (0-10)'), '11')
    expect(screen.getByText(STRESS_RANGE_MESSAGE)).toBeInTheDocument()
// add:
    expect(screen.getByLabelText('Stress (0-10)')).toHaveAccessibleDescription(STRESS_RANGE_MESSAGE)

// New test, alongside the others in the same describe('FeedRows', ...) block:
  it('the partial notice reads as a plain clause, not a middle-dot fragment', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '25')

    expect(screen.getByText(/partial/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('·')
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w @attention-lab/web -- FeedRows`
Expected: FAIL — two independent failures, one per test. In the existing stress test,
`toHaveAccessibleDescription(STRESS_RANGE_MESSAGE)` fails because the message today renders as a
plain sibling `<p role="alert">` with no `id`, so the stress input's accessible description is empty.
In the new partial-notice test, the first assertion (`getByText(/partial/i)`) already passes today —
the current markup's text already contains the word "Partial" — so the test's actual failure is its
second assertion, `expect(document.body.textContent ?? '').not.toContain('·')`: the current
markup renders `' · Partial — a report is missing for phone or desktop'` inside a `<span>`, and
`document.body.textContent` still contains U+00B7.

- [ ] **Step 3: Implement**

Import at the top of `FeedRows.tsx` — add to the block from Task 40:

```tsx
import { Textarea } from '../../ui/shadcn/textarea.js'
```

Full replacement of the `OptionalFields` function:

```tsx
export function OptionalFields({ stress, mindfulnessMinutes, note, onChange }: OptionalFieldsProps) {
  const stressMessage = validateStress(stress)
  const mindfulnessMessage = validateMindfulnessMinutes(mindfulnessMinutes)
  const stressField = useField({ name: 'checkin-stress', error: stressMessage })
  const mindfulnessField = useField({ name: 'checkin-mindfulness', error: mindfulnessMessage })
  const noteField = useField({ name: 'checkin-note' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label {...stressField.labelProps}>Stress (0-10)</Label>
        <Input
          {...stressField.controlProps}
          type="number"
          inputMode="numeric"
          step={1}
          value={stress === null ? '' : stress}
          onChange={(event) => {
            const next = parseBlankableInteger(event.target.value)
            if (next === undefined) return
            onChange({ stress: next })
          }}
          className="min-h-11 w-full max-w-40"
        />
        {stressField.errorProps !== undefined ? (
          <p {...stressField.errorProps} className="text-sm text-ink">
            {stressMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label {...mindfulnessField.labelProps}>Mindfulness minutes</Label>
        <Input
          {...mindfulnessField.controlProps}
          type="number"
          inputMode="numeric"
          step={1}
          value={mindfulnessMinutes === null ? '' : mindfulnessMinutes}
          onChange={(event) => {
            const next = parseBlankableInteger(event.target.value)
            if (next === undefined) return
            onChange({ mindfulnessMinutes: next })
          }}
          className="min-h-11 w-full max-w-40"
        />
        {mindfulnessField.errorProps !== undefined ? (
          <p {...mindfulnessField.errorProps} className="text-sm text-ink">
            {mindfulnessMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label {...noteField.labelProps}>Note</Label>
        <Textarea
          {...noteField.controlProps}
          value={note}
          onChange={(event) => onChange({ note: event.target.value })}
          className="w-full"
        />
      </div>
    </div>
  )
}
```

Full replacement of `apps/web/src/features/checkin/FeedTotals.tsx`:

```tsx
/**
 * Read-only feed totals preview for CheckinForm's "More detail" section
 * (task 8.7.2; design.md D36). Every number here comes straight from
 * `feedAggregates` (`packages/shared` `domain/feed.ts`) — this component
 * performs no arithmetic, summing or partial-detection of its own (D4).
 *
 * `rows` is the full current set of feed rows the day would save — the
 * still-active 8.7.1 headline ('all') rows alongside every complete detail
 * row (8.7.2) — exactly as `feedAggregates` expects: it sums scope-`feed`
 * rows regardless of whether they came from a headline field or a detail
 * row, and never adds short-video minutes on top of the total they are a
 * subset of.
 *
 * The partial notice is nested inside the same `feedDeviceMinutes !== null`
 * check as the total it qualifies, exactly as before this change — when
 * there is no feed-scope row for either device yet, `feedDeviceMinutes` is
 * `null` and neither line renders, so opening "More detail" on a
 * not-yet-started day does not lead with a "Partial" complaint about a total
 * that does not exist yet. It used to read " · Partial — a report is
 * missing for phone or desktop" on the same line as the total — a banned
 * middle-dot meta string (shadcn-ui-rework the rework spec §4) — and is now its
 * own plain-clause line; the design doc is explicit that the exact
 * replacement wording is not asserted by any test. Nothing here frames feed
 * minutes as a score to minimise or a number to be ashamed of: the flexible
 * cross-device feed policy supersedes the original zero-feed rule and
 * planned leisure scrolling is compatible with the program (CLAUDE.md).
 */
import { feedAggregates, type FeedRowValue } from '@attention-lab/shared'

import { toFeedRowInput } from './FeedRows.js'

export interface FeedTotalsProps {
  readonly rows: readonly FeedRowValue[]
}

export function FeedTotals({ rows }: FeedTotalsProps) {
  const aggregates = feedAggregates(rows.map(toFeedRowInput))

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      {aggregates.feedDeviceMinutes !== null ? (
        <>
          <p>
            {aggregates.feedDeviceMinutes} {aggregates.unitLabel} (feed)
          </p>
          {aggregates.partial ? <p>Partial: a report is missing for phone or desktop</p> : null}
        </>
      ) : null}
      {aggregates.shortVideoDeviceMinutes !== null ? <p>of which short video: {aggregates.shortVideoDeviceMinutes} min</p> : null}
      {aggregates.appTotals.map((row, index) => (
        <p key={index}>
          Broad app total: {row.minutes} min — {row.device} {row.platform}
        </p>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @attention-lab/web -- FeedRows`
Expected: PASS — all existing cases (including the `/partial/i` regex assertions in `'phone 0 +
desktop 20 reads 20 device-minutes without the partial label...'`, which still match since "Partial"
is still the leading word) plus the new accessible-description and plain-clause assertions.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/checkin/FeedRows.tsx apps/web/src/features/checkin/FeedTotals.tsx apps/web/src/features/checkin/FeedRows.test.tsx
git commit -m "$(cat <<'EOF'
Move OptionalFields onto shadcn Input/Textarea; drop FeedTotals' middle dot

Associates the stress/mindfulness range errors with their fields via
useField's aria-describedby wiring, and replaces FeedTotals' banned
middle-dot partial notice with a plain clause that states the same
data-completeness fact without editorializing on the feed-minutes number.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Practice review

Files owned by this unit: `apps/web/src/features/review/PracticeReview.tsx`,
`apps/web/src/features/review/CountField.tsx`, `apps/web/src/features/review/OutputQualityField.tsx`,
`apps/web/src/features/review/OutputNoteField.tsx`, `apps/web/src/features/review/ReviewNoteField.tsx`,
and the shared test file `apps/web/src/features/review/PracticeReview.test.tsx`.

Baseline facts confirmed by reading every file above, `docs/superpowers/plans/2026-09-09-shadcn-ui-rework.md`'s
frozen `useField`/`Reported` implementations (Tasks 6-7 there), and the e2e specs cited below, in full before
writing this plan:

- None of the five component files reference `radix-ui` except `OutputQualityField.tsx` (`import { RadioGroup } from 'radix-ui'`) — the one file in this unit that imports Radix directly and must move onto the generated `@/ui/shadcn/radio-group.js` wrapper.
- Every old-token reference in this unit is `var(--color-text)`, `var(--color-text-muted)`, `var(--color-border)`, `var(--color-bg)`, `var(--color-primary)`, plus one literal `text-red-600` on `OutputQualityField`'s error paragraph. All are enumerated below file by file.
- `OutputNoteField.tsx` and `ReviewNoteField.tsx` render **no** character counter today (`grep` of this unit's files for `.length}/{` / `remaining` / `characters` returns nothing) — unlike `Ready.tsx`'s replacement-reason field and `Recall.tsx`'s recall-points field, which do. The design doc's defects list (`## 9. Defects fixed en route`, item 2: "Character counters are not associated with their fields") names "review note" and "output note" alongside those two, but neither file in this unit currently renders a counter to mis-wire. No counter is added here: doing so would be a new feature, not a token/primitive port, and the design is frozen. Flagged as an uncertainty.
- `e2e/practice-review.spec.ts`'s "Keyboard-only" test pins the **exact literal DOM ids** `episode-count`, `external-count`, `unplanned-agent-checks`, `output-note`, `review-note` via `document.activeElement.id` in a fixed Tab order (lines 278-294), and separately pins the `output-quality-` prefix on the radio ids (line 262: `id.startsWith('output-quality-')`). `e2e/a11y/keyboard-review.spec.ts` does **not** pin any of this: its `readActiveElement`/`describeActiveElement` helpers return only `{role, name, tag}` (confirmed by grep — the only `.id` read anywhere in that file is an incidental `active.id.length > 0` branch used to look up a fallback label, never to assert a value), so it constrains Tab order by role and accessible name, never by DOM id.
- Two Playwright **acceptance** specs pin the count fields' ids a second, independent way, including the hint paragraph's id — not previously noted here: `e2e/acceptance/working-day.spec.ts:405-410` and `e2e/acceptance/recovery.spec.ts:430-431` both use `page.locator('#episode-count')` / `page.locator('#episode-count-hint')` (and `working-day.spec.ts` also `#external-count` / `#external-count-hint` / `#unplanned-agent-checks` / `#unplanned-agent-checks-hint`) rather than a role/label query. This means the **hint paragraph's** id must also stay the literal `${id}-hint` string, not only the input's.
- This is why `useField` (`@/ui/field.js`) is used in this unit **only** by `OutputQualityField` (Task 42). Its frozen implementation (`docs/superpowers/plans/2026-09-09-shadcn-ui-rework.md`, Task 7) mints every id as `` `${useId()}-${name}` `` — an opaque, per-render string, with no override for a caller-supplied literal id. `CountField`, `OutputNoteField` and `ReviewNoteField` (Task 43) cannot adopt it without breaking the acceptance specs above and the Keyboard-only test in the same motion, so they keep their exact hand-rolled `id`/`htmlFor`/`aria-describedby` wiring and only swap the rendered elements for the shadcn primitives. `OutputQualityField`'s error-paragraph id is never pinned anywhere in `e2e/` (confirmed by grep for `output-quality-error`), so it carries no such constraint and is the one file in this unit that does adopt `useField`.
- `e2e/recovery.spec.ts`'s "laptop slept during a benchmark" test (line 250) asserts `page.getByText('Timing uncertain')`, but that text belongs to `apps/web/src/features/focus/ClockGapPrompt.tsx:94` (a **benchmark**-only component this unit does not own — confirmed by grep and by that file's own header comment calling it "a 'Timing uncertain' chip") rather than to `PracticeReview.tsx:353`. `recovery.spec.ts` therefore provides **zero** e2e coverage of this unit's own Timing-uncertain badge; the only protection for Task 44's change to that markup is the new Vitest test it adds in the same task.
- `data-testid="recorded-tallies"` and its `dt`/`dd` sibling structure are pinned by `PracticeReview.test.tsx`'s `within(tallies).getByText(...).nextElementSibling?.textContent` assertions (lines 262-266).
- Wave 0's generated primitives export root-level named components matching shadcn's own generator (`RadioGroup`/`RadioGroupItem`, `Badge`, `Alert`/`AlertDescription`, `Skeleton`, etc.). This is confirmed directly for `Skeleton` against `docs/superpowers/plans/2026-09-09-shadcn-ui-rework.md` (hand-authored there because it also strips `animate-pulse`), and for `Alert` against shadcn's own upstream registry source (`raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/alert.tsx`, fetched directly while writing this plan: the root element carries `role="alert"`). `Badge` is not hand-authored in the master plan document, so this plan trusts the CLI's stock output for it. None of this section's tests key on `data-slot` or any other generated-primitive internal to prove any of this — every one keys on role, accessible name, visible text, or the `data-tier` attribute `@/ui/Reported.js` itself emits, so a Wave-0 naming surprise on an untested primitive would surface as a compile error on the named import, not a silently-wrong passing test.

---

### Task 42: `OutputQualityField` onto the shadcn radio-group primitive and `useField`

**Files:**
- Modify: `apps/web/src/features/review/OutputQualityField.tsx`
- Test: `apps/web/src/features/review/PracticeReview.test.tsx`

**Interfaces:**
- Consumes: `useField` (`@/ui/field.js`), `Label` (`@/ui/shadcn/label.js`), `RadioGroup`/`RadioGroupItem` (`@/ui/shadcn/radio-group.js`)
- Produces: `OutputQualityField(props: OutputQualityFieldProps)` — same public props (`value`, `onChange`, `error`) and same accessible names/roles; consumed unchanged by Task 44's `PracticeReview.tsx`

- [ ] **Step 1: Add a regression-guard test**
Design.md holds accessible names, roles and `data-testid`s fixed across this whole rework ("## 1. What this changes...": "Every accessible name, ARIA attribute, section label, fieldset legend and `data-testid` is held fixed"), and `OutputQualityField`'s `aria-describedby` → error `role="alert"` link is already correct **today** — it is the one wiring the design doc's own defects list calls out as already right (`## 9. Defects fixed en route`, item 2: "Only `OutputQualityField` wires its error correctly"). Swapping Radix's raw `RadioGroup.Item` for the generated wrapper changes no role, name or text a user or assistive technology could observe — both render a `button[role="radio"]` named by the same sibling label — so there is no new user-facing behavior to assert here. This test is a regression guard against the primitive swap breaking wiring that already works, not proof that the swap happened.

Add to `apps/web/src/features/review/PracticeReview.test.tsx`, inside the `describe('PracticeReview', ...)` block (next to the other `it(...)` cases):
```tsx
it('the blocked-submit error on output quality stays wired to the fieldset via aria-describedby and role=alert', async () => {
  const session = makeSession()
  respond('sessions.get', session)

  const { user } = renderReview(session.id)
  await waitForLoaded()

  const yesRadio = screen.getByRole('radio', { name: 'Yes' })

  await user.click(screen.getByRole('button', { name: 'Save review' }))

  const errorMessage = await screen.findByText('Choose Yes, Partly or No')
  expect(errorMessage).toHaveAttribute('role', 'alert')
  const fieldset = yesRadio.closest('fieldset')
  expect(fieldset).not.toBeNull()
  expect(fieldset).toHaveAttribute('aria-describedby', errorMessage.id)
})
```

- [ ] **Step 2: Run it and confirm it already passes**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: PASS, against the current, un-migrated file — nothing here is expected to fail first. Its only job is to catch Step 3's primitive swap accidentally breaking wiring that already works.

- [ ] **Step 3: Implement**
Replace the full contents of `apps/web/src/features/review/OutputQualityField.tsx`:
```tsx
import type { OutputQuality } from '@attention-lab/shared'

import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'

/**
 * Yes/Partly/No self-report of whether the planned output was produced
 * (task 8.6.2; `session_reviews.output_quality`). Required before Save can
 * submit (`PracticeReview.tsx` owns that validation and passes `error`
 * through only after a blocked submit attempt) — this component never
 * blocks selection itself, it only surfaces the message.
 *
 * Each option's accessible name comes from a sibling `Label htmlFor`
 * rather than wrapping the radio in a `<label>` (a button does not forward
 * a wrapping label's click the way a native input does). The fieldset's
 * `aria-describedby` -> error `role="alert"` wiring is the one place in
 * this app that was already correct before shadcn/`useField` existed
 * (design doc's defects list, item 2); `useField` now generates that same
 * link structurally instead of by hand, and this component's job is only
 * to preserve it.
 */
const OPTIONS: ReadonlyArray<{ value: OutputQuality; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No' },
]

export interface OutputQualityFieldProps {
  readonly value: OutputQuality | null
  readonly onChange: (value: OutputQuality) => void
  /** Set only after a blocked submit attempt (brief: "Choose Yes, Partly or No"). */
  readonly error: string | null
}

export function OutputQualityField({ value, onChange, error }: OutputQualityFieldProps) {
  const field = useField({ name: 'output-quality', error })

  return (
    <fieldset className="space-y-2" aria-describedby={field.controlProps['aria-describedby']}>
      <legend className="text-sm font-medium text-ink">Did you produce the planned output?</legend>
      <RadioGroup className="flex gap-4" value={value} onValueChange={(next) => onChange(next as OutputQuality)}>
        {OPTIONS.map((option) => {
          const id = `output-quality-${option.value}`
          return (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem id={id} value={option.value} />
              <Label htmlFor={id} className="text-sm text-ink">
                {option.label}
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm text-attention">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
```
Notes on the diff from the current file: `import { RadioGroup } from 'radix-ui'` is gone, replaced by the two shadcn named imports; `RadioGroup.Root`/`RadioGroup.Item`/`RadioGroup.Indicator` become `RadioGroup`/`RadioGroupItem` with no manual indicator markup (Wave 0's generated component owns that internally); every `text-[var(--color-text)]` becomes `text-ink`; the hand-rolled `border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]` item styling and the `bg-[var(--color-primary)]` indicator styling are deleted outright (owned by the shadcn primitive now); the error paragraph's `text-red-600` becomes `text-attention` — a required-field prompt is a "needs-you" state, not a measurement outcome, so it takes the `attention` token rather than reintroducing red (this design has no error/red token at all, by design: see the rework spec §3, "No red for measurement outcomes, ever").

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: PASS — every existing `PracticeReview.test.tsx` case (in particular `'missing outputQuality blocks submit with Choose Yes, Partly or No and no request is sent'` and the three `selectOutputQuality` call sites) keeps passing unmodified, plus the regression guard from Step 1.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/review/OutputQualityField.tsx apps/web/src/features/review/PracticeReview.test.tsx
git commit -m "$(cat <<'EOF'
Move OutputQualityField onto shadcn radio-group and useField

Retires the direct radix-ui import (one of eleven such files named in the
shadcn rework design) and swaps the hand-rolled fieldset aria-describedby
wiring for useField's structural version of the same link, which was
already correct before this change. No accessible name, role, or
test-visible id changes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 43: `CountField`, `OutputNoteField`, `ReviewNoteField` onto shadcn `Input`/`Textarea`/`Label`

**Files:**
- Modify: `apps/web/src/features/review/CountField.tsx`
- Modify: `apps/web/src/features/review/OutputNoteField.tsx`
- Modify: `apps/web/src/features/review/ReviewNoteField.tsx`
- Test: `apps/web/src/features/review/PracticeReview.test.tsx`

**Interfaces:**
- Consumes: `Input`/`Label` (`@/ui/shadcn/input.js`, `@/ui/shadcn/label.js`), `Textarea` (`@/ui/shadcn/textarea.js`). Deliberately does **not** consume `useField` (`@/ui/field.js`) — see the baseline facts above and each file's own doc comment below for why: `useField`'s frozen `` `${useId()}-${name}` `` id generation cannot reproduce the literal ids `e2e/practice-review.spec.ts`, `e2e/acceptance/working-day.spec.ts` and `e2e/acceptance/recovery.spec.ts` pin.
- Produces: `CountField(props: CountFieldProps)`, `OutputNoteField(props: OutputNoteFieldProps)`, `ReviewNoteField(props: ReviewNoteFieldProps)` — unchanged public prop shapes; `CountField`'s input now renders full-width (`w-full` instead of the fixed `w-28`), which Task 44's shared-grid-column layout relies on to line its edges up with the recorded-tallies columns above it

- [ ] **Step 1: Write the failing test**
Add to `apps/web/src/features/review/PracticeReview.test.tsx`:
```tsx
it('count and note fields move onto shadcn Input/Textarea/Label while keeping their pinned DOM ids, and the count input grows to share the tallies grid column width', async () => {
  const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 0 } })
  respond('sessions.get', session)

  renderReview(session.id)
  await waitForLoaded()

  const episodeInput = screen.getByLabelText('How many times did you switch away?')
  expect(episodeInput).toHaveAttribute('id', 'episode-count')
  expect(episodeInput.className).toMatch(/\bw-full\b/)
  expect(episodeInput.className).not.toMatch(/\bw-28\b/)

  const outputNoteInput = screen.getByLabelText('What did you finish? (optional)')
  expect(outputNoteInput).toHaveAttribute('id', 'output-note')

  const reviewNoteInput = screen.getByLabelText('Notes (optional)')
  expect(reviewNoteInput).toHaveAttribute('id', 'review-note')
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: FAIL on `expect(episodeInput.className).toMatch(/\bw-full\b/)` — the current `CountField` renders its input with the fixed `min-h-11 w-28 rounded-md border ...` class list, which contains no `w-full` token, so the match fails. Execution stops there; the two note-field `id` checks below it are never reached in this run. (The line above it, `expect(episodeInput).toHaveAttribute('id', 'episode-count')`, already passes against the current file — `CountField` already hand-rolls that literal id today — so it is a regression guard here, not new coverage; likewise the two note-field `id` checks would already pass today, were they reached.)

- [ ] **Step 3: Implement**
Replace the full contents of `apps/web/src/features/review/CountField.tsx`:
```tsx
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * One self-reported count field (episode/S, external/E or unplanned agent
 * checks) on `PracticeReview` (task 8.6.2; design.md D31). May stay blank —
 * blank is "not reported", never coerced to 0 — and shows a "prefilled from
 * recorded events" hint whenever its current value came from the D31
 * prefill rule and the caller has not yet typed into it (`PracticeReview.tsx`
 * decides `prefilled`, this component only renders it).
 *
 * Deliberately does NOT go through `useField` (`@/ui/field.js`): that hook
 * mints its DOM id as `` `${useId()}-${name}` ``, which would replace the
 * literal `id` this component is called with (`episode-count`,
 * `external-count`, `unplanned-agent-checks`) with an opaque per-render
 * string. `e2e/practice-review.spec.ts`'s "Keyboard-only" test reads
 * `document.activeElement.id` against that exact literal, and
 * `e2e/acceptance/working-day.spec.ts` / `e2e/acceptance/recovery.spec.ts`
 * both read `page.locator('#episode-count')` and
 * `page.locator('#episode-count-hint')` directly — so both the input's id
 * and the hint paragraph's `${id}-hint` id stay exactly as hand-rolled
 * today; only the rendered elements move onto the generated `Input`/`Label`.
 *
 * Keystrokes that would not parse as a non-negative integer (a bare "-",
 * a decimal point, ...) are ignored rather than committing a bad value —
 * the input's own displayed text still reflects the last-accepted value
 * (controlled), so an invalid keystroke has no visible effect instead of
 * silently becoming 0 or NaN.
 */
export interface CountFieldProps {
  readonly id: string
  readonly label: string
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly prefilled: boolean
}

export function CountField({ id, label, value, onChange, prefilled }: CountFieldProps) {
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value === null ? '' : String(value)}
        aria-describedby={prefilled ? hintId : undefined}
        className="w-full"
        onChange={(event) => {
          const raw = event.target.value
          if (raw.trim() === '') {
            onChange(null)
            return
          }
          const parsed = Number(raw)
          if (!Number.isInteger(parsed) || parsed < 0) {
            // Not a valid ReportedCount keystroke (e.g. "-", a decimal) — leave the committed value untouched.
            return
          }
          onChange(parsed)
        }}
      />
      {prefilled ? (
        <p id={hintId} className="text-xs text-ink-muted">
          prefilled from recorded events
        </p>
      ) : null}
    </div>
  )
}
```
Replace the full contents of `apps/web/src/features/review/OutputNoteField.tsx`:
```tsx
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * The one-line "what did you finish" self-report (task 8.6.2;
 * `session_reviews.output_note`, D31). Always optional — `PracticeReview.tsx`
 * omits it from the finalize body entirely when blank, and sends the typed
 * text verbatim (no trimming) when not.
 *
 * No error or description to wire, and `output-note` is a pinned
 * `e2e/practice-review.spec.ts` Tab-stop id, so this keeps a direct
 * `id`/`htmlFor` pair rather than routing through `useField`
 * (`CountField.tsx`'s doc comment explains why).
 */
export interface OutputNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 200

export function OutputNoteField({ value, onChange }: OutputNoteFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="output-note" className="block text-sm font-medium text-ink">
        What did you finish? (optional)
      </Label>
      <Input
        id="output-note"
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        className="w-full"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
```
Replace the full contents of `apps/web/src/features/review/ReviewNoteField.tsx`:
```tsx
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'

/**
 * The optional longer free-text note (task 8.6.2; `session_reviews.review_note`,
 * D31). Independent of `OutputNoteField` — both may be set at once, and each
 * is omitted from the finalize body on its own when left blank.
 *
 * `review-note` is a pinned `e2e/practice-review.spec.ts` Tab-stop id, so
 * this keeps a direct `id`/`htmlFor` pair rather than routing through
 * `useField` (`CountField.tsx`'s doc comment explains why).
 */
export interface ReviewNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 2000

export function ReviewNoteField({ value, onChange }: ReviewNoteFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="review-note" className="block text-sm font-medium text-ink">
        Notes (optional)
      </Label>
      <Textarea
        id="review-note"
        value={value}
        maxLength={MAX_LENGTH}
        rows={4}
        className="w-full"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
```
Notes on the diff from the current files: only the rendered elements change (`<label>` → `Label`, `<input>`/`<textarea>` → `Input`/`Textarea`), and every `text-[var(--color-text)]`/`text-[var(--color-text-muted)]` token becomes `text-ink`/`text-ink-muted`; `CountField`'s fixed `w-28` becomes `w-full`. All id generation, `aria-describedby` wiring, and change-handling logic stay byte-for-byte the same as today — see the "Interfaces" note above and each file's doc comment for why `useField` is not used here, unlike `OutputQualityField` (Task 42).

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: PASS — including the pre-existing `'flushes the outbox on mount...'`, `'renders blank counts when tallies are 0...'`, `'editing a prefilled S switches countMethod to retrospective'`, `'explicit 0 is sent as 0, never omitted'`, and `'outputNote is optional...'` cases, none of which change behavior (blank stays `null`, an explicit `0` keystroke still commits, the prefilled hint still appears/disappears on the same conditions) — only the underlying elements changed, not the id/aria wiring around them.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/review/CountField.tsx apps/web/src/features/review/OutputNoteField.tsx apps/web/src/features/review/ReviewNoteField.tsx apps/web/src/features/review/PracticeReview.test.tsx
git commit -m "$(cat <<'EOF'
Move CountField, OutputNoteField and ReviewNoteField onto shadcn primitives

Swaps the three fields' raw <input>/<textarea>/<label> for the generated
Input/Textarea/Label. Their id/hint/aria-describedby wiring stays
byte-for-byte hand-rolled rather than routed through useField, because
useField's ${useId()}-${name} id generation cannot reproduce the literal
ids e2e/practice-review.spec.ts, e2e/acceptance/working-day.spec.ts and
e2e/acceptance/recovery.spec.ts pin (episode-count, external-count,
unplanned-agent-checks, output-note, review-note, and the *-hint ids).
CountField's input also grows from a fixed w-28 to w-full ahead of Task
34's shared grid.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 44: `PracticeReview.tsx` — the two aligned registers, the `Timing uncertain` badge, and the value taxonomy

**Files:**
- Modify: `apps/web/src/features/review/PracticeReview.tsx`
- Test: `apps/web/src/features/review/PracticeReview.test.tsx`

**Interfaces:**
- Consumes: `Reported` (`@/ui/Reported.js`), `Badge` (`@/ui/shadcn/badge.js`), `Separator` (`@/ui/shadcn/separator.js`); `CountField`'s `w-full` `Input` from Task 43 (so the two grids' columns land on the same edges)
- Produces: nothing new for other units — `PracticeReview` is a leaf route component (`/review/:sessionId`); adds `data-testid="attested-counts"` (not part of the preserved contract, safe to introduce)

- [ ] **Step 1: Write the failing test**
Add to `apps/web/src/features/review/PracticeReview.test.tsx`:
```tsx
it('the Timing uncertain flag renders inside a Badge as the uncertain tier, not a plain chip', async () => {
  const session = makeSession({ timerQuality: 'uncertain' })
  respond('sessions.get', session)

  renderReview(session.id)
  await waitForLoaded()

  const badgeText = screen.getByText('Timing uncertain')
  expect(badgeText).toHaveAttribute('data-tier', 'uncertain')
})

it('a session with no intended output shows Planned output: Not reported in the absent tier, never the old None recorded string', async () => {
  const session = makeSession({ intendedOutput: null })
  respond('sessions.get', session)

  renderReview(session.id)
  await waitForLoaded()

  expect(screen.queryByText('None recorded', { exact: false })).not.toBeInTheDocument()
  const value = screen.getByText('Not reported')
  expect(value).toHaveAttribute('data-tier', 'absent')
})

it('the recorded tallies and the counts you attest to share one three-column grid so their values line up', async () => {
  const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 0 } })
  respond('sessions.get', session)

  renderReview(session.id)
  await waitForLoaded()

  const tallies = screen.getByTestId('recorded-tallies')
  const attested = screen.getByTestId('attested-counts')
  expect(tallies.className).toMatch(/grid-cols-3/)
  expect(attested.className).toMatch(/grid-cols-3/)
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: FAIL on all three cases, each on its own first assertion (each `it` block is independent, so all three fail simultaneously without violating the one-failure-per-block rule):
- Test 1 fails at `expect(badgeText).toHaveAttribute('data-tier', 'uncertain')` — the current markup is a plain `<p className="inline-block rounded-full border ...">Timing uncertain</p>` with no `data-tier` attribute at all.
- Test 2 fails at its **first** assertion, `expect(screen.queryByText('None recorded', { exact: false })).not.toBeInTheDocument()` — the current file renders exactly `'None recorded'` in the Planned-output line (`{session.intendedOutput ?? 'None recorded'}`), so `queryByText` finds that `<p>` and the negated assertion throws; execution never reaches the `getByText('Not reported')` line below it in this run.
- Test 3 fails at `screen.getByTestId('attested-counts')` — `screen.getByTestId('recorded-tallies')` on the line above it already exists today and is found first, but there is no `attested-counts` container yet, so this throws `Unable to find an element by: [data-testid="attested-counts"]`.

- [ ] **Step 3: Implement**
In `apps/web/src/features/review/PracticeReview.tsx`, add three new imports. `Button` (`../../ui/Button.js`, line 67 of the current file) and `CountField` (`./CountField.js`, line 68) are **already imported** — do not re-add them, or the file gains two duplicate import declarations and fails to compile. Insert these three lines immediately after the existing `import { Button } from '../../ui/Button.js'` line and before the existing `import { CountField } from './CountField.js'` line:
```tsx
import { Reported } from '../../ui/Reported.js'
import { Badge } from '../../ui/shadcn/badge.js'
import { Separator } from '../../ui/shadcn/separator.js'
```
Replace the component's entire `return (...)` statement — starting at the `return (` that follows `const message = statusMessage(finalizeHook.status)`, through its matching closing `)` (the current file's lines 342-428) — with:
```tsx
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-ink">Practice review</h1>

      <div className="space-y-1 text-sm text-ink">
        <p>
          Planned output: <Reported>{session.intendedOutput ?? 'Not reported'}</Reported>
        </p>
        <p>
          {elapsedMinutes} min recorded of {targetMinutes} min target (pauses excluded)
        </p>
        {session.timerQuality === 'uncertain' ? (
          <Badge variant="outline" className="border-attention/40">
            <Reported>Timing uncertain</Reported>
          </Badge>
        ) : null}
      </div>

      <dl data-testid="recorded-tallies" className="grid grid-cols-3 gap-3 text-sm text-ink">
        <div>
          <dt className="text-ink-muted">Off-task, recorded</dt>
          <dd>{session.tallies.offTask}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">External, recorded</dt>
          <dd>{session.tallies.external}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Agent checks, recorded</dt>
          <dd>{session.tallies.agentChecks}</dd>
        </div>
      </dl>

      <Separator />

      <form onSubmit={handleSubmit} className="space-y-6">
        <OutputQualityField
          value={state.outputQuality}
          onChange={(value) => dispatch({ kind: 'output_quality_changed', value })}
          error={outputQualityErrorShown ? OUTPUT_QUALITY_REQUIRED_MESSAGE : null}
        />

        <div data-testid="attested-counts" className="grid grid-cols-3 gap-3">
          <CountField
            id="episode-count"
            label="How many times did you switch away?"
            value={state.episodeCount}
            prefilled={!state.touched.episodeCount && state.episodeCount !== null}
            onChange={(value) => dispatch({ kind: 'episode_count_changed', value })}
          />
          <CountField
            id="external-count"
            label="How many were external interruptions?"
            value={state.externalCount}
            prefilled={!state.touched.externalCount && state.externalCount !== null}
            onChange={(value) => dispatch({ kind: 'external_count_changed', value })}
          />
          <CountField
            id="unplanned-agent-checks"
            label="How many unplanned agent checks?"
            value={state.unplannedAgentChecks}
            prefilled={!state.touched.unplannedAgentChecks && state.unplannedAgentChecks !== null}
            onChange={(value) => dispatch({ kind: 'unplanned_agent_checks_changed', value })}
          />
        </div>

        <OutputNoteField value={state.outputNote} onChange={(value) => dispatch({ kind: 'output_note_changed', value })} />
        <ReviewNoteField value={state.reviewNote} onChange={(value) => dispatch({ kind: 'review_note_changed', value })} />

        <div className="space-y-2">
          <Button type="submit" variant="primary" disabled={saveDisabled}>
            Save review
          </Button>
          {message !== null ? (
            <div role="status" className="flex items-center gap-3 text-sm text-attention">
              <p>{message}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void finalizeHook.retry()
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  )
```
Four deliberate decisions worth naming explicitly, since a reviewer needs the reasoning, not just the diff:
1. The recorded-time line (`{elapsedMinutes} min recorded of {targetMinutes} min target ...`) is **not** wrapped in `<Reported>`. `elapsedSeconds`/`targetSeconds` are non-nullable numbers with no absent/uncertain state to represent, and `PracticeReview.test.tsx`'s existing `'recorded-time line reads X min recorded...'` test asserts the whole sentence as one `getByText` string — splitting it across a nested `<span>` would break that exact-string match for no taxonomy benefit.
2. The three `dd` tally values are left as plain numbers (not wrapped in `<Reported>`) for the same reason: `tallies.offTask/external/agentChecks` are non-nullable, so their tier is trivially always `'recorded'`, and the existing `.nextElementSibling?.textContent` assertions expect the `dd`'s only content to be the bare number.
3. `Timing uncertain` is wrapped in `<Reported>` inside the `Badge` rather than styled by hand with a bespoke amber className. Design.md's three-tier taxonomy (`## 5. The three-tier value taxonomy`) already classifies `Timing uncertain` as an uncertain-tier string alongside `Unknown` (the `UNCERTAIN` set in `docs/superpowers/plans/2026-09-09-shadcn-ui-rework.md`'s `reported.ts`), so routing it through the same `<Reported>` component keeps one taxonomy implementation instead of a second hand-rolled amber class, and gives Step 1's test a real, non-internal signal (`data-tier="uncertain"`) to assert on.
4. The `role="status"` sync message (`statusMessage(...)`) becomes `text-attention` rather than staying neutral `text-ink`: "Some entries have not been saved yet" and "The review could not be saved. Retry." are both need-you states with a visible Retry action, which is exactly the job design.md's Colour table (§3) scopes the `attention` token to — its `attention` row reads "Amber. Needs-you, and uncertainty." This is a visual-only change with no dedicated test — verify by opening `/review/:id` after forcing `mockApi.sessions.finalize` to reject (or, live, triggering an `event_count_mismatch`) and confirming the message renders in amber, not the page's default ink.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: PASS on every case, including the three new ones and the pre-existing `'tallies off-task 1 and agent checks 1 (alsoOffTask) render both...'` and `'recorded-time line reads X min recorded of Y min target...'` cases. Then also run `npm run test -w @attention-lab/web -- CountField` — there is no separate `CountField.test.tsx`, so this is expected to report "no test files found" harmlessly (`passWithNoTests: true` in `apps/web/vitest.config.ts`); coverage for `CountField` lives entirely in `PracticeReview.test.tsx`.

Separately, for the hairline and column-width claims that no unit test can verify pixel-for-pixel: run `npm run dev:web`, sign in via `local-demo`, drive a practice block to its review screen, and confirm on screen that (a) a single thin rule separates the read-only block from the form, with no boxed card anywhere on the page, and (b) the "Off-task, recorded" / "External, recorded" / "Agent checks, recorded" column edges line up directly above the "How many times did you switch away?" / "How many were external interruptions?" / "How many unplanned agent checks?" input edges.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/review/PracticeReview.tsx apps/web/src/features/review/PracticeReview.test.tsx
git commit -m "$(cat <<'EOF'
Align Practice review's two registers and apply the value taxonomy

Recorded tallies and the counts you attest to now share one grid-cols-3
template so their columns line up, separated by a single hairline instead
of a box or a label. Timing uncertain now renders through the same
<Reported> taxonomy component as every other uncertain-tier value, inside
a shadcn Badge container; the planned-output line is rewritten from the ad
hoc 'None recorded' string to the app-wide 'Not reported' string, also
wrapped in <Reported>, so both render in their correct tier instead of
looking like a real value.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 45: `PracticeReview.tsx` — loading, load-error, 404 and already-saved states

**Files:**
- Modify: `apps/web/src/features/review/PracticeReview.tsx`
- Test: `apps/web/src/features/review/PracticeReview.test.tsx`

**Interfaces:**
- Consumes: `VisuallyHidden` (`@/ui/VisuallyHidden.js`, pre-existing, unchanged), `Skeleton` (`@/ui/shadcn/skeleton.js`), `Alert`/`AlertDescription` (`@/ui/shadcn/alert.js`)
- Produces: nothing — leaf task

- [ ] **Step 1: Write the failing test**
Add to `apps/web/src/features/review/PracticeReview.test.tsx`:
```tsx
it('a non-404 load error renders inside an alert region, not a bare paragraph', async () => {
  mockApi.sessions.get.mockRejectedValue(new Error('network exploded'))

  renderReview('77777777-7777-4777-8777-777777777777')

  expect(await screen.findByRole('alert')).toHaveTextContent('The review could not be loaded.')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
})

it('the pending session query renders multiple static ruled placeholder rows rather than a bare loading sentence', async () => {
  mockApi.sessions.get.mockImplementation(() => new Promise(() => {}))

  const { container } = renderReview('88888888-8888-4888-8888-888888888888')

  const busyRegion = container.querySelector('[aria-busy="true"]')
  expect(busyRegion).not.toBeNull()
  expect(busyRegion?.children.length ?? 0).toBeGreaterThan(1)
  expect(screen.getByText('Loading review')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: FAIL on both, each on its own first non-passing assertion:
- Test 1 fails at `await screen.findByRole('alert')`, which times out — the current branch renders a bare `<p>The review could not be loaded.</p>` with no `role` attribute anywhere in it, so no element has the accessible role `alert`. The `Retry` button check on the line after is never reached in this run.
- Test 2 fails at `expect(busyRegion?.children.length ?? 0).toBeGreaterThan(1)` — the current pending branch renders only the bare text node `Loading review` as the sole content of the `aria-busy` div, so that div has zero element children. `busyRegion` itself is found on the line above (`aria-busy="true"` is already present on both versions, so that check is a regression guard), and the final `getByText('Loading review')` line — unreached here — would already pass against the current file too, since the text is present either way.

- [ ] **Step 3: Implement**
In `apps/web/src/features/review/PracticeReview.tsx`, add imports:
```tsx
import { VisuallyHidden } from '../../ui/VisuallyHidden.js'
import { Alert, AlertDescription } from '../../ui/shadcn/alert.js'
import { Skeleton } from '../../ui/shadcn/skeleton.js'
```
Replace the four early-return blocks (from `if (sessionId === undefined) {` through the `if (session.lifecycle === 'finalized') {` block, inclusive — the current file's lines 281-323) with:
```tsx
  if (sessionId === undefined) {
    return <p className="text-ink">Session not found</p>
  }

  if (sessionQuery.isError) {
    if (sessionQuery.error instanceof NotFoundError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-6 space-y-2">
          <p className="text-ink">Session not found</p>
          <Link to="/today" className="text-sm text-signal underline underline-offset-2">
            Go to Today
          </Link>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
        <Alert>
          <AlertDescription>The review could not be loaded.</AlertDescription>
        </Alert>
        <Button
          onClick={() => {
            void sessionQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (sessionQuery.isPending || session === undefined) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-4" aria-busy="true">
        <VisuallyHidden>Loading review</VisuallyHidden>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (session.lifecycle === 'finalized') {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-2">
        <p className="text-ink">This review was already saved</p>
        <Link to="/today" className="text-sm text-signal underline underline-offset-2">
          Go to Today
        </Link>
      </div>
    )
  }
```
The `aria-busy="true"` attribute (preserved-contract) stays on the same wrapping `div`. `Loading review` stays present for assistive tech via `VisuallyHidden` (also pre-existing, unchanged) rather than as visible text, since the visible surface is now the four ruled `Skeleton` slots — matching design.md's "a loading placeholder renders as a static unfilled ruled slot, the same mark as 'not reported'" (`## 4. Type, structure, motion`) and its Wave 0 sequencing note that `Skeleton`'s pulse is already stripped there (`## 10. Implementation sequencing`: "component installation with focus rings stripped and `Skeleton`'s pulse removed"), so nothing here needs to touch that.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- PracticeReview`
Expected: PASS on all cases, including the pre-existing `'GET 404 renders Session not found with a link to Today'` case (unchanged behavior, only token classes added) and the two new ones from Step 1.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/review/PracticeReview.tsx apps/web/src/features/review/PracticeReview.test.tsx
git commit -m "$(cat <<'EOF'
Adopt the shell's Alert and static-skeleton patterns on Practice review

The generic load-error branch now renders inside a shadcn Alert (role=alert
preserved on its root) instead of a bare paragraph, and the pending-query
branch shows four static ruled Skeleton slots (aria-busy preserved, Loading
review kept for assistive tech via VisuallyHidden) instead of a plain
loading sentence, matching the app-wide loading/error treatment the shell
defines.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Progress and comparison

### Task 46: The claim, tiered — ResultState, ComparisonFigures, ComparabilityWarnings, SamplesLine

**Files:**
- Modify: `apps/web/src/features/progress/format.ts`
- Modify: `apps/web/src/features/progress/ComparisonFigures.tsx`
- Modify: `apps/web/src/features/progress/ComparabilityWarnings.tsx`
- Modify: `apps/web/src/features/progress/SamplesLine.tsx`
- Test: `apps/web/src/features/progress/ResultState.test.tsx`

**Interfaces:**
- Consumes: `Reported` (`../../ui/Reported.js`, `{ children: string; mono?: boolean; className?: string }`, renders `<span data-tier={tier}>`); `absenceTier` is applied internally by `Reported`, never called directly here.
- Produces: `formatSwitchChange(absoluteChange: number): string`, `formatPercentageChange(percentageReduction: number | null): string`, `formatRecallMean(value: number): string` — all exported from `format.ts`, consumed by `ComparisonFigures.tsx` (Task 46) and available to any later task in this unit.

`ResultState.tsx` itself needs no source change — it already contains no `--color-*` reference and already varies nothing but the headline by state. This task adds the regression test that makes that fact machine-checked instead of merely true by inspection, per the unit brief: "card styling must NEVER vary by state."

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/progress/ResultState.test.tsx`, make two import edits, then add new `it` blocks inside the existing `describe('ResultState / ComparisonFigures / ComparabilityWarnings (8.8.2)', ...)`, after its last existing test (`'comparison without meanFirstSwitch (two capped, two known) renders no mean T; with it renders one'`):

1. In the existing multi-line `@attention-lab/shared` import, add `RESULT_STATES,` immediately after `RESULT_STATE_COPY,`.
2. Add one new import line after the existing `import { ComparisonFigures } from './ComparisonFigures.js'` line and before `import { ResultState } from './ResultState.js'`:

```ts
import { formatPercentageChange, formatRecallMean, formatSwitchChange } from './format.js'
```

```tsx
  it('card styling never varies across the eight result states — only the headline does', () => {
    // Asserts the section's own `className` only — never a shadcn-internal
    // `data-slot` marker, which is invisible to users and assistive tech and
    // is not what this regression test exists to protect. `ResultState.tsx`
    // renders a plain `<section>`, so the meaningful check is that its
    // `className` never differs across all eight states — "only the
    // headline is allowed to vary".
    const rendered = RESULT_STATES.map((state) => {
      const { unmount } = render(<ResultState resultState={state} />)
      const section = screen.getByTestId('result-state')
      const snapshot = { state, className: section.className }
      unmount()
      return snapshot
    })

    const [first, ...rest] = rendered
    if (first === undefined) throw new Error('RESULT_STATES is empty')
    for (const entry of rest) {
      expect(entry.className).toBe(first.className)
    }
  })

  it('the percentage figure is tiered: a real percentage is recorded, "Percentage: not applicable" is absent', () => {
    const comparable = comparisonFor('comparable-change')
    const { unmount } = render(<ComparisonFigures comparison={comparable} />)
    expect(screen.getByTestId('percentage-figure').querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')
    unmount()

    const zeroBaseline = comparisonFor('zero-baseline')
    render(<ComparisonFigures comparison={zeroBaseline} />)
    expect(screen.getByTestId('percentage-figure').querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })

  it('s0/s14, recall means and mean first-switch render as mono tabular figures — "tabular figures in comparisons" is the one place besides timer digits and exact-values tables that mono is allowed', () => {
    const comparison = comparisonFor('comparable-change')
    render(<ComparisonFigures comparison={comparison} />)

    const s0s14Tier = screen.getByTestId('s0-s14-figure').querySelector('[data-tier]')
    expect(s0s14Tier).toHaveAttribute('data-tier', 'recorded')
    expect(s0s14Tier).toHaveClass('font-mono')

    const recallTier = screen.getByTestId('recall-means-figure').querySelector('[data-tier]')
    expect(recallTier).toHaveClass('font-mono')
  })

  it('formatSwitchChange: positive is N fewer switch(es), negative is N more switch(es), zero is a plain no-change sentence', () => {
    expect(formatSwitchChange(2)).toBe('2 fewer switches')
    expect(formatSwitchChange(1)).toBe('1 fewer switch')
    expect(formatSwitchChange(-2)).toBe('2 more switches')
    expect(formatSwitchChange(-1)).toBe('1 more switch')
    expect(formatSwitchChange(0)).toBe('No change in switches')
  })

  it('formatPercentageChange: null is "Percentage: not applicable", a non-negative value reads as a reduction, a negative value as an increase of its absolute magnitude', () => {
    expect(formatPercentageChange(null)).toBe('Percentage: not applicable')
    expect(formatPercentageChange(40)).toBe('40% reduction')
    expect(formatPercentageChange(-66.7)).toBe('66.7% increase')
  })

  it('formatRecallMean: whole-number means never show a trailing .0', () => {
    expect(formatRecallMean(4)).toBe('4')
    expect(formatRecallMean(4.5)).toBe('4.5')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- ResultState.test.tsx`
Expected: FAIL. `formatSwitchChange`/`formatPercentageChange`/`formatRecallMean` don't exist yet in `format.ts` (import error). The `[data-tier]`/`font-mono` assertions fail with `querySelector(...)` returning `null` because `ComparisonFigures` does not yet render through `<Reported>`. The card-styling test itself would pass today (nothing to regress yet) but is kept in this same step since it belongs beside the other `ResultState`/`ComparisonFigures` assertions.

- [ ] **Step 3: Implement**

Add to `apps/web/src/features/progress/format.ts` (after `formatDisruption`):

```ts
/**
 * The comparison's absolute-change wording — pluralised, and phrased as a
 * measurement outcome rather than a judgement. Moved here from
 * `ComparisonFigures.tsx`'s own inline `switchWord`/if-chain (the rework spec §9,
 * defect 5: "ComparisonFigures builds its change ... text inline").
 */
export function formatSwitchChange(absoluteChange: number): string {
  if (absoluteChange > 0) {
    const word = absoluteChange === 1 ? 'switch' : 'switches'
    return `${absoluteChange} fewer ${word}`
  }
  if (absoluteChange < 0) {
    const more = Math.abs(absoluteChange)
    const word = more === 1 ? 'switch' : 'switches'
    return `${more} more ${word}`
  }
  return 'No change in switches'
}

/**
 * `null` (guaranteed exactly when `s0 === 0`) -> 'Percentage: not
 * applicable' — one of the taxonomy's own named absent-tier strings
 * (the rework spec §5) — never 'Infinity', 'NaN' or '100%'. Otherwise the signed
 * reduction/increase wording; the sign only ever changes the WORD, never the
 * server-computed number under `Math.abs`. Moved here from
 * `ComparisonFigures.tsx` (the rework spec §9, defect 5).
 */
export function formatPercentageChange(percentageReduction: number | null): string {
  if (percentageReduction === null) {
    return 'Percentage: not applicable'
  }
  if (percentageReduction >= 0) {
    return `${percentageReduction}% reduction`
  }
  return `${Math.abs(percentageReduction)}% increase`
}

/** `4` -> '4', `4.5` -> '4.5' — never a trailing '.0' for a whole-number mean. Moved here from `ComparisonFigures.tsx`'s file-local `formatMean` (the rework spec §9, defect 5). */
export function formatRecallMean(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
```

Also in `apps/web/src/features/progress/format.ts`, remove the one remaining middle-dot join, in
`formatConditions`: the rework spec §4 prohibits "meta strings joined with middle dots" as one of
generated design's commonest tells, and names `FeedTotals.tsx`'s own middle-dot string as the example
to rewrite as a plain clause. `formatConditions`'s join carries the identical pattern and is not
asserted by any test — `AttemptTable` has no standalone test file, `Progress.test.tsx`'s only
`conditions` fixture (`{ deviceFormat: null, language: null, materialLevel: null, accommodations: [] }`)
is all-null and renders `NOT_REPORTED` without ever reaching the join, and no `e2e/` spec asserts the
Conditions column — so, like `FeedTotals.tsx`, it is rewritten:

```diff
-/** A short human summary of one attempt's observed conditions, joined with ' · '. */
+/**
+ * A short human summary of one attempt's observed conditions, joined with
+ * ', ' — never a middle dot (the rework spec §4: "meta strings joined with
+ * middle dots" is a prohibited typographic treatment). Unlike
+ * `FeedTotals.tsx`'s equivalent string, this one is not asserted by any
+ * test, so there is no fixture to keep in sync.
+ */
 export function formatConditions(conditions: ObservedConditions): string {
   const parts = [conditions.deviceFormat, conditions.language, conditions.materialLevel].filter(
     (part): part is string => part !== null,
   )
   if (conditions.accommodations.length > 0) {
     parts.push(conditions.accommodations.join(', '))
   }
-  return parts.length > 0 ? parts.join(' · ') : NOT_REPORTED
+  return parts.length > 0 ? parts.join(', ') : NOT_REPORTED
 }
```

Replace the whole of `apps/web/src/features/progress/ComparisonFigures.tsx`:

```tsx
/**
 * The Progress report's baseline/final comparison figures (task 8.8.2;
 * progress-report spec: "Comparison mathematics", "No invented scores").
 * Mounted only when `report.comparison` exists (the caller's job — 8.8.1's
 * `Progress.tsx`); every number here is read straight off `ComparisonValue`
 * (2.4.1/2.7.5) and never recomputed (D4) — this component only formats and
 * chooses wording, it never derives `s0 - s14`, a percentage, or a mean of
 * its own.
 *
 * - `S0 → S14` always shown, even at a zero baseline (e.g. "0 → 0").
 * - The absolute-change figure is pluralised correctly and always precedes
 *   the percentage — the low-baseline rule's "leads with the absolute
 *   count".
 * - The percentage renders "Percentage: not applicable" exactly when
 *   `percentageReduction` is `null` — never `Infinity`, `NaN` or `100%` —
 *   and is wrapped in `<Reported>` so that absent tier renders as the same
 *   ink-muted ruled mark as every other "not a value" in the app, never a
 *   number-shaped placeholder.
 * - `lowBaseline` (s0 < 3) additionally shows a low-baseline note beside the
 *   percentage, explaining why the absolute count is the steadier figure —
 *   it never hides or alters the percentage itself.
 * - Recall means always render as "recall A → B".
 * - A mean first-switch time renders only when the server provided one
 *   (`firstSwitchMeanSeconds !== null`, i.e. all four attempts were
 *   `known`) — never a partial average over fewer than four.
 * - `s0 → s14`, the recall means and the mean first-switch time render in
 *   `<Reported mono>` — these are "tabular figures in comparisons", one of
 *   the three contexts mono is permitted in (the rework spec §4); the pluralised
 *   change sentence and the cause note are prose and stay `font-sans`.
 * - The cause note accompanies every rendered comparison, unconditionally.
 */
import type { ComparisonValue } from '@attention-lab/shared'
import { CAUSE_NOTE } from '@attention-lab/shared'

import { Reported } from '../../ui/Reported.js'
import { formatMmSs, formatPercentageChange, formatRecallMean, formatSwitchChange } from './format.js'

export interface ComparisonFiguresProps {
  readonly comparison: ComparisonValue
}

export function ComparisonFigures({ comparison }: ComparisonFiguresProps) {
  const {
    s0,
    s14,
    absoluteChange,
    percentageReduction,
    lowBaseline,
    recallBaselineMean,
    recallFinalMean,
    firstSwitchMeanSeconds,
  } = comparison

  const changeText = formatSwitchChange(absoluteChange)
  const percentageText = formatPercentageChange(percentageReduction)

  return (
    <section aria-label="Comparison figures" className="flex flex-col gap-2" data-testid="comparison-figures">
      <p data-testid="s0-s14-figure">
        <Reported mono>{`${s0} → ${s14}`}</Reported>
      </p>
      <p data-testid="change-figure">{changeText}</p>
      <p data-testid="percentage-figure">
        <Reported>{percentageText}</Reported>
      </p>
      {lowBaseline ? (
        <p className="text-sm text-ink-muted" data-testid="low-baseline-note">
          With fewer than three baseline switches, a percentage is unstable; the count above is the more reliable
          figure.
        </p>
      ) : null}
      <p data-testid="recall-means-figure">
        <Reported mono>{`recall ${formatRecallMean(recallBaselineMean)} → ${formatRecallMean(recallFinalMean)}`}</Reported>
      </p>
      {firstSwitchMeanSeconds !== null ? (
        <p data-testid="mean-first-switch-figure">
          <Reported mono>{`Mean T ${formatMmSs(Math.round(firstSwitchMeanSeconds))}`}</Reported>
        </p>
      ) : null}
      <p className="text-sm text-ink-muted" data-testid="cause-note">
        {CAUSE_NOTE}
      </p>
    </section>
  )
}
```

In `apps/web/src/features/progress/ComparabilityWarnings.tsx`, convert the one token reference:

```diff
     <ul
       aria-label="Comparability warnings"
-      className="flex flex-col gap-1 text-sm text-[var(--color-text-muted)]"
+      className="flex flex-col gap-1 text-sm text-ink-muted"
       data-testid="comparability-warnings"
     >
```

In `apps/web/src/features/progress/SamplesLine.tsx`, convert the one token reference:

```diff
-      <p className="text-sm text-[var(--color-text-muted)]">All counts are self-reported</p>
+      <p className="text-sm text-ink-muted">All counts are self-reported</p>
```

This file has a second, unrelated middle dot — the eligible-sample line itself (`{samples.baselineEligible}
of 2 baseline samples eligible · {samples.finalEligible} of 2 final samples eligible`). It is left exactly
as it stands: the full string, dot included, is asserted verbatim by
`apps/web/src/features/progress/Progress.test.tsx:110`
(`'1 of 2 baseline samples eligible · 0 of 2 final samples eligible'`) and by
`e2e/acceptance/comparison-guards.spec.ts:154`
(`'2 of 2 baseline samples eligible · 1 of 2 final samples eligible'`). Rewriting it as a plain clause
would fail both, and updating those fixtures is not one of this task's named fixes, so it stays.

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- ResultState.test.tsx`
Expected: PASS — all eighteen `it` blocks in the file (the twelve existing plus the six added in Step 1), including the eight-state card-neutrality check, the recorded/absent percentage tiering, the mono tabular-figure check, and the three new formatter unit tests.

Also run the full existing suite for this file's siblings to confirm nothing else regressed:
Run: `npm run test -w @attention-lab/web -- Progress.test.tsx Trends.test.tsx`
Expected: PASS (these files don't yet reference the new formatters or `<Reported>`, so they should be unaffected by this task alone).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/progress/format.ts apps/web/src/features/progress/ComparisonFigures.tsx apps/web/src/features/progress/ComparabilityWarnings.tsx apps/web/src/features/progress/SamplesLine.tsx apps/web/src/features/progress/ResultState.test.tsx
git commit -m "$(cat <<'EOF'
Tier the Progress claim: ComparisonFigures via <Reported>, card-neutral result states

Percentage: not applicable now renders as the same ink-muted ruled mark as
every other absence; s0/s14, recall means and mean-T get the mono tabular
treatment reserved for timer digits, exact-values tables and comparison
figures. formatSwitchChange/formatPercentageChange/formatRecallMean move out
of ComparisonFigures' own inline logic into the shared formatters (design.md
§9, defect 5). formatConditions drops its middle-dot join for a plain comma
(design.md §4 bans middle-dot meta strings); it was unasserted, so nothing
else changes. A new regression test locks the eight result states to
identical card styling — only the headline is allowed to vary.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 47: The ledger — AttemptTable on shadcn Table, AmendmentDialog on shadcn Dialog

**Files:**
- Modify: `apps/web/src/features/progress/AttemptTable.tsx`
- Modify: `apps/web/src/features/progress/AmendmentDialog.tsx`
- Test: `apps/web/src/features/progress/Progress.test.tsx`
- Test: `apps/web/src/features/progress/AmendmentDialog.test.tsx`

**Interfaces:**
- Consumes: `Reported` (`../../ui/Reported.js`); `useField` (`../../ui/field.js`, `UseFieldOptions`/`FieldWiring` exactly as frozen); `Button` (`../../ui/Button.js`, unchanged); shadcn primitives `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableCaption` (`../../ui/shadcn/table.js`), `Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogFooter`/`DialogTitle`/`DialogDescription` (`../../ui/shadcn/dialog.js`), `Textarea` (`../../ui/shadcn/textarea.js`), `Checkbox` (`../../ui/shadcn/checkbox.js`).
- Produces: nothing new for later tasks — `AttemptTableRow`/`AttemptTableProps`/`AmendmentDialogProps`/`AmendmentListProps` are unchanged.

This is the densest table in the app and its one interactive control. `AttemptTable` is tested only through `Progress.test.tsx` (there is no standalone `AttemptTable.test.tsx`), so the tiering assertions below extend that file's existing tests by name rather than adding a new file.

`AttemptTable`'s own `<table>`/`overflow-x-auto`/`tabIndex={0}` wrapper is kept exactly, rather than switching to shadcn's own `Table` root component: that component renders a *second* `overflow-x-auto` wrapper div with no `tabIndex`, and since this table has no set width the outer div would never itself become the scrolling element — the inner shadcn-generated div would, and it would fail axe's `scrollable-region-focusable` check instead of passing it. This task therefore imports only the shadcn table *parts* (`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableCaption`) onto the existing plain `<table>`, exactly as `ExactValuesTable.tsx` will (Task 48) — both wrappers keep the single scroll affordance the accessibility suite already depends on.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/progress/Progress.test.tsx`, extend four existing tests and add one new test.

Extend `'null S renders Not reported and the S cell never contains 0'`:

```tsx
  it('null S renders Not reported and the S cell never contains 0', async () => {
    const attempt = makeAttempt({
      attemptId: 'attempt-null-s',
      label: 'A',
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
    })
    mount(makeReport({ attempts: [attempt] }))

    const cell = await screen.findByTestId('s-attempt-null-s')
    expect(cell).toHaveTextContent('Not reported')
    expect(cell.textContent).not.toBe('0')
    expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })
```

Extend `'T none_capped renders 20+, capped; known 370 s renders 6:10; unknown renders Unknown and never 20+'`:

```tsx
  it('T none_capped renders 20+, capped; known 370 s renders 6:10; unknown renders Unknown and never 20+', async () => {
    const capped = makeAttempt({ attemptId: 'attempt-capped', label: 'A', firstSwitch: { kind: 'none_capped' } })
    const known = makeAttempt({
      attemptId: 'attempt-known',
      label: 'B',
      phase: 'final',
      firstSwitch: { kind: 'known', seconds: 370 },
    })
    const unknown = makeAttempt({
      attemptId: 'attempt-unknown',
      label: 'A',
      phase: 'final',
      countMethod: 'retrospective',
      firstSwitch: { kind: 'unknown' },
      firstSwitchMethod: null,
    })
    mount(makeReport({ attempts: [capped, known, unknown] }))

    const cappedCell = await screen.findByTestId('t-attempt-capped')
    expect(cappedCell).toHaveTextContent('20+, capped')
    // '20+, capped' is a measurement (twenty minutes elapsed, no switch) —
    // named RECORDED explicitly here rather than trusted to a default; this
    // is the value the three-tier taxonomy exists to protect (the rework spec §5).
    expect(cappedCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const knownCell = screen.getByTestId('t-attempt-known')
    expect(knownCell).toHaveTextContent('6:10')
    expect(knownCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const unknownCell = screen.getByTestId('t-attempt-unknown')
    expect(unknownCell).toHaveTextContent('Unknown')
    expect(unknownCell.textContent).not.toContain('20+')
    expect(unknownCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'uncertain')
  })
```

Extend `'null recall renders Not reported'`:

```tsx
  it('null recall renders Not reported', async () => {
    const attempt = makeAttempt({ attemptId: 'attempt-recall', label: 'A', recallScore: null })
    mount(makeReport({ attempts: [attempt] }))

    const cell = await screen.findByTestId('recall-attempt-recall')
    expect(cell).toHaveTextContent('Not reported')
    expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })
```

Extend `'a running attempt renders its lifecycle word and Not finalized in every scored column, with no Explain or exclude control'`:

```tsx
    const scoredTestIds = ['s', 't', 'recall', 'e', 'm', 'disruption', 'eligibility']
    for (const id of scoredTestIds) {
      const cell = screen.getByTestId(`${id}-attempt-running`)
      expect(cell).toHaveTextContent('Not finalized')
      expect(cell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
    }
```

Add a new test, after the running-attempt test:

```tsx
  it('eligibility, exclusion reasons and protocol revision are tiered: Eligible/a reason list are recorded, the — dash is absent', async () => {
    const eligible = makeAttempt({ attemptId: 'attempt-eligible', label: 'A' })
    const ineligible = makeAttempt({
      attemptId: 'attempt-ineligible',
      label: 'B',
      eligible: false,
      exclusionReasons: ['count_unknown'],
      revisionId: 'rev-missing',
    })
    mount(makeReport({ attempts: [eligible, ineligible] }))

    const eligibleCell = await screen.findByTestId('eligibility-attempt-eligible')
    expect(eligibleCell).toHaveTextContent('Eligible')
    expect(eligibleCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const ineligibleCell = screen.getByTestId('eligibility-attempt-ineligible')
    expect(ineligibleCell).toHaveTextContent('Not eligible')
    expect(ineligibleCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const noExclusionCell = screen.getByTestId('exclusion-attempt-eligible')
    expect(noExclusionCell).toHaveTextContent('—')
    expect(noExclusionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')

    const withExclusionCell = screen.getByTestId('exclusion-attempt-ineligible')
    expect(withExclusionCell).toHaveTextContent(EXCLUSION_REASON_COPY.count_unknown)
    expect(withExclusionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    // attempt-ineligible's revisionId ('rev-missing') matches no revision in
    // the mounted report's `revisions: [REVISION]` (id 'rev-1'), so
    // `withRevisionNumbers` (Progress.tsx) maps it to `revisionNumber: null`
    // — rendered as the dash, same as an unreported count.
    const revisionCell = screen.getByTestId('revision-attempt-ineligible')
    expect(revisionCell).toHaveTextContent('—')
    expect(revisionCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })
```

In `apps/web/src/features/progress/AmendmentDialog.test.tsx`, add one new test after `'empty reason blocks submit with A reason is required and no request is sent'`:

```tsx
  it('the reason field associates its required error via aria-describedby and aria-invalid', async () => {
    const { user } = renderWithProviders(<AmendmentDialog sessionId="session-1" amendments={[]} />)
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    const errorText = await screen.findByText('A reason is required')
    const textarea = screen.getByLabelText('Reason')

    expect(errorText).toHaveAttribute('role', 'alert')
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea.getAttribute('aria-describedby')).toContain(errorText.id)
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- Progress.test.tsx AmendmentDialog.test.tsx`
Expected: FAIL. Every new `cell.querySelector('[data-tier]')` call returns `null` because `AttemptTable` does not yet wrap any cell in `<Reported>`, and `toHaveAttribute` on a `null` element throws. The new `exclusion-*`/`revision-*` test IDs don't exist yet (`getByTestId` throws "Unable to find an element"). The new `AmendmentDialog` test fails because the reason `<textarea>` currently has no `aria-describedby` at all (`getAttribute` returns `null`, and `null.toContain` is not a real assertion path — the test fails at `expect(textarea.getAttribute('aria-describedby')).toContain(...)` with `null` not matching a string).

- [ ] **Step 3: Implement**

Replace the whole of `apps/web/src/features/progress/AttemptTable.tsx`:

```tsx
/**
 * The Progress report's benchmark-attempt table (task 8.8.1). Every column
 * renders a value the server already computed — nothing here derives
 * eligibility, a score or a percentage of its own (D4).
 *
 * A row whose `lifecycle` is not `'finalized'` (running, paused,
 * awaiting_review, abandoned) shows that lifecycle word in its own Status
 * column and 'Not finalized' in every finalized-only column (S, T, recall
 * score, E, M, disruption, eligibility) — never a blank-as-null value, so an
 * in-progress or abandoned attempt can never be mistaken for a finalized
 * attempt that simply left counts unreported. The 'Explain or exclude'
 * amendment control is likewise only ever mounted for a finalized row.
 *
 * Every cell whose text can be one of the three-tier taxonomy's own strings
 * (a `ReportedCount`, a `FirstSwitch`, the disruption attestation,
 * eligibility, exclusion reasons, or the revision dash) is wrapped in
 * `<Reported>`, which tiers it: '20+, capped' is explicitly RECORDED (a
 * measurement, not an absence — the value this taxonomy exists to protect),
 * 'Unknown' is UNCERTAIN (amber), and 'Not reported'/'Not finalized'/'—' are
 * all ABSENT (ink-muted, ruled). S/T/Recall/E/M additionally render
 * `<Reported mono>`: this table is one of the two dense data tables
 * the rework spec §4 names explicitly ("the dense data tables (`AttemptTable` and
 * `ExactValuesTable` alike — digits must not shift in either)"), one of the
 * three contexts mono is permitted in.
 *
 * shadcn's own `Table` root component renders a SECOND `overflow-x-auto`
 * wrapper div with no `tabIndex`; since this table has no fixed width, that
 * inner div — not this file's own outer one — would become the actual
 * scrolling element, and it would fail axe's "scrollable-region-focusable"
 * check instead of passing it. So this keeps its existing single wrapper and
 * composes shadcn's table PARTS onto a plain `<table>`.
 */
import type { AttemptValue } from '@attention-lab/shared'

import { Reported } from '../../ui/Reported.js'
import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../ui/shadcn/table.js'
import { AmendmentDialog } from './AmendmentDialog.js'
import {
  formatConditions,
  formatDisruption,
  formatEpisodeCount,
  formatExclusionReasons,
  formatFirstSwitch,
  formatLifecycle,
  formatPhase,
  formatReportedCount,
  formatTimeSource,
  NOT_FINALIZED,
} from './format.js'

/** `AttemptValue` plus the revision NUMBER (never the raw `revisionId`) `Progress.tsx` joins in from `report.revisions`. */
export interface AttemptTableRow extends AttemptValue {
  readonly revisionNumber: number | null
}

export interface AttemptTableProps {
  readonly attempts: readonly AttemptTableRow[]
}

const COLUMN_HEADERS = [
  'Phase',
  'Label',
  'Date',
  'Time source',
  'Status',
  'S',
  'T',
  'Recall score',
  'E',
  'M',
  'Disruption',
  'Conditions',
  'Eligibility',
  'Exclusion reasons',
  'Protocol revision',
] as const

export function AttemptTable({ attempts }: AttemptTableProps) {
  if (attempts.length === 0) {
    return <p>No benchmark attempts yet.</p>
  }

  return (
    // See ExactValuesTable.tsx's identical comment: `tabIndex={0}` for axe's
    // "scrollable-region-focusable" (WCAG 2.1.1); no `role="region"` (the
    // table's own caption already names it, and a second named landmark
    // collided with other same-page region names in practice).
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <TableCaption className="sr-only">Benchmark attempts</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-rule text-ink-muted">
            {COLUMN_HEADERS.map((header) => (
              <TableHead key={header} scope="col" className="px-2 py-2 font-medium">
                {header}
              </TableHead>
            ))}
            <TableHead scope="col" className="px-2 py-2">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((attempt) => {
            const finalized = attempt.lifecycle === 'finalized'
            const revisionText =
              attempt.revisionNumber === null ? '—' : `Revision ${attempt.revisionNumber}`

            return (
              <TableRow key={attempt.attemptId} className="border-b border-rule align-top">
                <TableCell className="px-2 py-2">{formatPhase(attempt.phase)}</TableCell>
                <TableCell className="px-2 py-2">{attempt.label}</TableCell>
                <TableCell className="px-2 py-2">{attempt.localDate}</TableCell>
                <TableCell className="px-2 py-2">{formatTimeSource(attempt.timeSource)}</TableCell>
                <TableCell className="px-2 py-2" data-testid={`status-${attempt.attemptId}`}>
                  {formatLifecycle(attempt.lifecycle)}
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`s-${attempt.attemptId}`}>
                  <Reported mono>
                    {finalized ? formatEpisodeCount(attempt.episodeCount, attempt.countMethod) : NOT_FINALIZED}
                  </Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`t-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatFirstSwitch(attempt.firstSwitch) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`recall-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.recallScore) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`e-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.externalCount) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`m-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.mindWanderingCount) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`disruption-${attempt.attemptId}`}>
                  <Reported>{finalized ? formatDisruption(attempt.materiallyDisrupted) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`conditions-${attempt.attemptId}`}>
                  <Reported>{formatConditions(attempt.conditions)}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`eligibility-${attempt.attemptId}`}>
                  {/* `eligible` is `Type.Boolean()` on the wire (report.ts's
                      AttemptSchema) — never null — so only NOT_FINALIZED
                      ever hits the absent tier here; 'Eligible'/'Not
                      eligible' both default to recorded. Tiered anyway: a
                      reviewer scanning this row for what's a real value and
                      what isn't should never have to remember which columns
                      "count". */}
                  <Reported>{finalized ? (attempt.eligible ? 'Eligible' : 'Not eligible') : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`exclusion-${attempt.attemptId}`}>
                  <Reported>{formatExclusionReasons(attempt.exclusionReasons)}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2" data-testid={`revision-${attempt.attemptId}`}>
                  <Reported>{revisionText}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2">
                  {finalized ? (
                    // KNOWN LIMITATION: the report's AttemptValue schema carries no
                    // per-attempt amendments[] field (only the derived
                    // excludedByAmendment flag), so a previously created amendment
                    // (from an earlier page load) will not appear in this dialog's
                    // list until AttemptValue gains a real amendments[] field or this
                    // table fetches GET /sessions/{attemptId} per row. An amendment
                    // created in the SAME browser session appears immediately
                    // (AmendmentDialog appends its own 201 response locally).
                    <AmendmentDialog sessionId={attempt.attemptId} amendments={[]} />
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </table>
    </div>
  )
}
```

Edit `apps/web/src/features/progress/AmendmentDialog.tsx` — imports:

```diff
 import { useId, useState, type FormEvent } from 'react'
-import { Dialog } from 'radix-ui'
 import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
 import type { AmendmentBodyValue, AmendmentResponseValue } from '@attention-lab/shared'

 import { api } from '../../lib/api/client.js'
 import { Button } from '../../ui/Button.js'
+import { useField } from '../../ui/field.js'
+import { Checkbox } from '../../ui/shadcn/checkbox.js'
+import {
+  Dialog,
+  DialogContent,
+  DialogDescription,
+  DialogFooter,
+  DialogHeader,
+  DialogTitle,
+  DialogTrigger,
+} from '../../ui/shadcn/dialog.js'
+import { Textarea } from '../../ui/shadcn/textarea.js'
```

`AmendmentList` — drop the boxed/filled `<li>` (Card is reserved for genuinely raised things; this list already lives inside the dialog, which IS the raised surface — no card inside a card) in favour of one hairline per row, and convert the muted-text tokens:

```diff
 export function AmendmentList({ amendments }: AmendmentListProps) {
   if (amendments.length === 0) {
-    return <p className="text-sm text-[var(--color-text-muted)]">No amendments yet.</p>
+    return <p className="text-sm text-ink-muted">No amendments yet.</p>
   }

   return (
-    <ul className="flex flex-col gap-2">
+    <ul className="flex flex-col">
       {amendments.map((amendment) => (
-        <li
-          key={amendment.id}
-          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
-        >
-          <p className="text-[var(--color-text)]">{amendment.reason}</p>
-          <p className="text-[var(--color-text-muted)]">
+        <li key={amendment.id} className="border-b border-rule py-2 text-sm last:border-b-0">
+          <p className="text-ink">{amendment.reason}</p>
+          <p className="text-ink-muted">
             {amendment.excludeFromReport ? 'Excluded from the comparison' : 'Not excluded'}
           </p>
-          <p className="text-xs text-[var(--color-text-muted)]">{amendment.createdAt}</p>
+          <p className="text-xs text-ink-muted">{amendment.createdAt}</p>
         </li>
       ))}
     </ul>
   )
 }
```

`AmendmentDialog` — drop the manual `reasonId` (superseded by `useField`), keep `excludeId`, wire the reason field's error through `useField`, and swap the hand-rolled Dialog/textarea/checkbox markup for the shadcn primitives:

```diff
 export function AmendmentDialog({ sessionId, amendments }: AmendmentDialogProps) {
   const queryClient = useQueryClient()
-  const reasonId = useId()
   const excludeId = useId()

   const [open, setOpen] = useState(false)
   const [reason, setReason] = useState('')
   const [excludeFromReport, setExcludeFromReport] = useState(false)
   const [created, setCreated] = useState<readonly AmendmentResponseValue[]>([])
   const [reasonRequiredError, setReasonRequiredError] = useState(false)
   const [fieldError, setFieldError] = useState<string | undefined>(undefined)
   const [saveError, setSaveError] = useState<string | null>(null)
   const [notice, setNotice] = useState<string | null>(null)
```

```diff
   const allAmendments = [...amendments, ...created]
   const isPending = mutation.isPending
+  // `useField` owns id generation and the aria-describedby/aria-invalid
+  // wiring the reason textarea previously lacked entirely (the rework spec §9,
+  // defect 2 — "only OutputQualityField wires its error correctly").
+  // `reasonRequiredError` and `fieldError` are mutually exclusive in
+  // practice (a 400 field error can only arrive from a submit that already
+  // passed the empty-reason check), so a single `useField` call covers both.
+  const reasonError = reasonRequiredError ? REASON_REQUIRED_MESSAGE : fieldError
+  const reasonField = useField({ name: 'amendment-reason', error: reasonError ?? null, required: true })

   return (
     <>
-      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
-        <Dialog.Trigger className="inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]">
-          Explain or exclude
-        </Dialog.Trigger>
-        <Dialog.Portal>
-          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
-          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
-            <Dialog.Title className="text-base font-semibold text-[var(--color-text)]">
-              Explain or exclude this attempt
-            </Dialog.Title>
-            <Dialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
-              This attempt&apos;s stored counts, recall and score never change. A reason is kept alongside it,
-              optionally excluding it from the comparison.
-            </Dialog.Description>
+      <Dialog open={open} onOpenChange={handleOpenChange}>
+        <DialogTrigger asChild>
+          <Button variant="secondary">Explain or exclude</Button>
+        </DialogTrigger>
+        <DialogContent>
+          <DialogHeader>
+            <DialogTitle>Explain or exclude this attempt</DialogTitle>
+            <DialogDescription>
+              This attempt&apos;s stored counts, recall and score never change. A reason is kept alongside it,
+              optionally excluding it from the comparison.
+            </DialogDescription>
+          </DialogHeader>

             <div className="mt-4">
               <AmendmentList amendments={allAmendments} />
             </div>

             <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
               <div className="flex flex-col gap-1">
-                <label htmlFor={reasonId} className="text-sm font-medium text-[var(--color-text)]">
+                <label {...reasonField.labelProps} className="text-sm font-medium text-ink">
                   Reason
                 </label>
-                <textarea
-                  id={reasonId}
+                <Textarea
+                  {...reasonField.controlProps}
                   value={reason}
                   disabled={isPending}
-                  aria-invalid={reasonRequiredError || fieldError !== undefined ? true : undefined}
-                  className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
+                  className="min-h-20"
                   onChange={(event) => {
                     setReason(event.target.value)
                   }}
                 />
-                {reasonRequiredError ? (
-                  <p role="alert" className="text-sm text-red-700">
-                    {REASON_REQUIRED_MESSAGE}
-                  </p>
-                ) : null}
-                {fieldError !== undefined ? (
-                  <p role="alert" className="text-sm text-red-700">
-                    {fieldError}
-                  </p>
-                ) : null}
+                {reasonField.errorProps !== undefined ? (
+                  // ink, not red or amber: the rework spec §3 names "a validation
+                  // message" alongside the 422/409/failed-save banners as
+                  // something that "renders neutrally, in ink, keeping its
+                  // existing role='alert'". Amber is reserved for the
+                  // uncertain data tier (§5: 'Unknown', 'Timing uncertain'),
+                  // never a form validation prompt.
+                  <p {...reasonField.errorProps} className="text-sm text-ink">
+                    {reasonError}
+                  </p>
+                ) : null}
               </div>

-              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
-                <input
+              <div className="flex items-center gap-2 text-sm text-ink">
+                <Checkbox
                   id={excludeId}
-                  type="checkbox"
                   checked={excludeFromReport}
                   disabled={isPending}
-                  onChange={(event) => {
-                    setExcludeFromReport(event.target.checked)
+                  onCheckedChange={(checked) => {
+                    setExcludeFromReport(checked === true)
                   }}
                 />
-                Exclude from the comparison
-              </label>
+                <label htmlFor={excludeId}>Exclude from the comparison</label>
+              </div>

               {saveError !== null ? (
-                <p role="alert" className="text-sm text-red-700">
+                <p role="alert" className="text-sm text-ink">
                   {saveError}
                 </p>
               ) : null}

-              <div className="mt-2 flex justify-end gap-3">
+              <DialogFooter>
                 <Button
                   type="button"
                   variant="secondary"
                   disabled={isPending}
                   onClick={() => handleOpenChange(false)}
                 >
                   Cancel
                 </Button>
                 <Button type="submit" variant="primary" disabled={isPending}>
                   Save
                 </Button>
-              </div>
+              </DialogFooter>
             </form>
-          </Dialog.Content>
-        </Dialog.Portal>
-      </Dialog.Root>
+        </DialogContent>
+      </Dialog>

       {notice !== null ? (
-        <p role="status" className="mt-1 text-xs text-[var(--color-text-muted)]">
+        <p role="status" className="mt-1 text-xs text-ink-muted">
           {notice}
         </p>
       ) : null}
     </>
   )
 }
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- Progress.test.tsx AmendmentDialog.test.tsx`
Expected: PASS — all of `Progress.test.tsx`'s original ten tests, four of them extended with tiering assertions, plus the new eligibility/exclusion/revision test (eleven total); all of `AmendmentDialog.test.tsx`'s original eight tests (accessible names for the trigger, "Reason" label, "Exclude from the comparison" checkbox, and the `role="dialog"` are all unchanged, so none of the existing `getByRole`/`getByLabelText` queries needed to change) plus the new `aria-describedby` test (nine total).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/progress/AttemptTable.tsx apps/web/src/features/progress/AmendmentDialog.tsx apps/web/src/features/progress/Progress.test.tsx apps/web/src/features/progress/AmendmentDialog.test.tsx
git commit -m "$(cat <<'EOF'
Move AttemptTable onto shadcn Table parts and AmendmentDialog onto shadcn Dialog

Every scored cell (S/T/recall/E/M/disruption/eligibility/exclusion
reasons/protocol revision) now renders through <Reported>, with '20+,
capped' explicitly asserted RECORDED at its render site rather than left to
a default. AmendmentDialog moves onto Dialog/Textarea/Checkbox and wires its
reason field's error through useField, fixing the missing
aria-describedby association the manual markup never had.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 48: The trends — ExactValuesTable on shadcn Table, the repalette, the practice frame/fill

**Files:**
- Modify: `apps/web/src/features/progress/ExactValuesTable.tsx`
- Modify: `apps/web/src/features/progress/PracticeTrend.tsx`
- Modify: `apps/web/src/features/progress/DailyTrend.tsx`
- Modify: `apps/web/src/features/progress/trendFormat.ts`
- Test: `apps/web/src/features/progress/Trends.test.tsx`

**Interfaces:**
- Consumes: `Reported` (`../../ui/Reported.js`); shadcn `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableCaption` (`../../ui/shadcn/table.js`).
- Produces: `formatStress(stress: number | null): string`, exported from `trendFormat.ts`, consumed by `DailyTrend.tsx`.

`ExactValuesTable` gets the same "shadcn table parts on a plain `<table>`" treatment as `AttemptTable` (Task 47), for the identical reason: its own comment already documents the `role="region"` collision this pattern was chosen to avoid, and swapping in shadcn's own `Table` wrapper would introduce the same untabbable second scroll container. Because `ExactValuesTable` literally is "the exact-values tables" named in the mono rule (the rework spec §4), its body cells render `font-mono` at the table level (headers stay `font-sans`, since mono is never for labels).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/progress/Trends.test.tsx`, add two new `it` blocks inside the existing `describe('PracticeTrend / DailyTrend / ExactValuesTable', ...)`, after `'blank practice counts render Not reported'`:

```tsx
  it('Timer flag column renders all three tiers: OK recorded, Timing uncertain amber, Not reported absent', () => {
    // `timerQuality` is `Type.Optional` on `PracticeRowValue`, and apps/web
    // runs with `exactOptionalPropertyTypes: true` (tsconfig.base.json), so
    // `makePracticeRow({ ..., timerQuality: undefined })` does not typecheck
    // (TS2379 — an explicit `undefined` is not the same thing as omitting an
    // optional property under that flag). The "not reported" row is built by
    // destructuring the key back OFF a normal row instead: the result
    // genuinely lacks `timerQuality`, which is exactly what "not reported"
    // means, and is still a valid `PracticeRowValue` since the field is
    // optional.
    const { timerQuality: _omittedTimerQuality, ...unsetRow } = makePracticeRow({
      sessionId: 's-unset',
      day: 3,
      localDate: '2026-09-03',
      targetSeconds: 600,
    })
    const rows = [
      makePracticeRow({ sessionId: 's-ok', day: 1, localDate: '2026-09-01', targetSeconds: 600, timerQuality: 'ok' }),
      makePracticeRow({
        sessionId: 's-uncertain',
        day: 2,
        localDate: '2026-09-02',
        targetSeconds: 600,
        timerQuality: 'uncertain',
      }),
      unsetRow,
    ]
    renderWithProviders(<PracticeTrend practice={rows} />)

    // Column order is COLUMNS' own fixed order (Day, Date, Block, Planned,
    // Completed, Output quality, S, E, Agent checks, Timer flag, Time
    // source) — index 9 is Timer flag.
    function timerCellForDay(day: number): HTMLElement {
      const row = screen
        .getAllByRole('row')
        .find((candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent === String(day))
      if (row === undefined) throw new Error(`no row rendered for day ${day}`)
      const cell = within(row).getAllByRole('cell')[9]
      if (cell === undefined) throw new Error('Timer flag column missing')
      return cell
    }

    const okCell = timerCellForDay(1)
    expect(okCell).toHaveTextContent('OK')
    expect(okCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const uncertainCell = timerCellForDay(2)
    expect(uncertainCell).toHaveTextContent('Timing uncertain')
    expect(uncertainCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'uncertain')

    const unsetCell = timerCellForDay(3)
    expect(unsetCell).toHaveTextContent('Not reported')
    expect(unsetCell.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')
  })

  it('stress renders through <Reported> as a recorded figure, never a bare number outside the taxonomy', () => {
    const days = [makeDayRow({ localDate: '2026-09-01', day: 1, stress: 4 })]
    renderWithProviders(<DailyTrend days={days} />)

    const stressText = screen.getByText('4', { selector: '[data-tier]' })
    expect(stressText).toHaveAttribute('data-tier', 'recorded')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- Trends.test.tsx`
Expected: FAIL. The Timer flag test's `cell.querySelector('[data-tier]')` calls return `null` (PracticeTrend doesn't yet wrap that column in `<Reported>`), failing `toHaveAttribute`. The stress test's `screen.getByText('4', { selector: '[data-tier]' })` throws "Unable to find an element" because `DailyTrend` currently renders the raw number `4` directly with no wrapping element at all.

- [ ] **Step 3: Implement**

Replace the whole of `apps/web/src/features/progress/ExactValuesTable.tsx`:

```tsx
/**
 * The shared "exact values" table primitive (task 8.8.3), reused by
 * `PracticeTrend` and `DailyTrend`: progress-report spec, "Charts carry
 * exact values" — every chart in this section is accompanied by the exact
 * numbers and their source labels in an ordinary, non-`aria-hidden` table,
 * so the chart is never the only place a value lives.
 *
 * Body cells render `font-mono` at the table level: this IS "the
 * exact-values tables" named in the rework spec §4's mono rule. Headers are
 * pulled back to `font-sans` — mono is never for labels or metadata, only
 * for the figures themselves.
 *
 * See `AttemptTable.tsx`'s identical comment for why this composes shadcn's
 * table PARTS (`TableHeader`/`TableBody`/`TableRow`/`TableHead`/
 * `TableCell`/`TableCaption`) onto a plain `<table>` rather than using
 * shadcn's own `Table` wrapper: that component's own internal
 * `overflow-x-auto` div has no `tabIndex`, and nesting it inside this file's
 * wrapper would make the WRONG div the one axe expects to be focusable.
 */
import type { ReactNode } from 'react'

import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../ui/shadcn/table.js'

export interface ExactValuesTableRow {
  readonly key: string
  readonly cells: readonly ReactNode[]
}

export interface ExactValuesTableProps {
  readonly caption: string
  readonly columns: readonly string[]
  readonly rows: readonly ExactValuesTableRow[]
  readonly emptyMessage: string
}

export function ExactValuesTable({ caption, columns, rows, emptyMessage }: ExactValuesTableProps) {
  if (rows.length === 0) {
    return <p>{emptyMessage}</p>
  }

  return (
    // `tabIndex={0}`: axe's "scrollable-region-focusable" (WCAG 2.1.1) — a
    // horizontally-scrollable region with real (non-hidden) content must
    // itself be reachable and operable by keyboard. No `role="region"`/
    // `aria-label` here: the table's own `caption` already gives it an
    // accessible name, and adding a SECOND named landmark on top collided
    // with other same-page region names in practice (confirmed empirically
    // — `day8-revision.spec.ts`'s own `getByRole('region', {name:
    // 'Practice'})` started matching two elements once this wrapper's
    // 'Practice blocks' label was added).
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-left font-mono text-sm">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-rule text-ink-muted">
            {columns.map((column) => (
              <TableHead key={column} scope="col" className="px-2 py-2 font-sans font-medium">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} className="border-b border-rule align-top">
              {row.cells.map((cell, index) => (
                // `index` is a stable key here: a row's cell list is fixed
                // (one entry per `columns`) and never reordered independently
                // of its own row.
                <TableCell key={index} className="px-2 py-2">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  )
}
```

Add to `apps/web/src/features/progress/trendFormat.ts` (after `formatCheckinStatus`):

```ts
/** Self-reported stress 1–10, or 'Not reported' for `null` — never coerced to '0' (CLAUDE.md: unknown != zero). Always a string, so it can pass through <Reported> like every other cell in this table. Moved here from `DailyTrend.tsx`'s own inline ternary (the rework spec §9, defect 5). */
export function formatStress(stress: number | null): string {
  return stress === null ? NOT_REPORTED : String(stress)
}
```

Replace the whole of `apps/web/src/features/progress/PracticeTrend.tsx`:

```tsx
/**
 * The Progress report's practice trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx`. Pure presentation of
 * `report.practice` (`PracticeRowValue[]`, `packages/shared/src/contracts/
 * report.ts`, 6.2.4) — nothing here derives a score or a completion state
 * the server did not already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * practice blocks show per-day planned/completed durations, output quality
 * and per-block counts, with a note that durations vary — practice is never
 * compared against the fixed 20-minute benchmark. The bar chart is
 * `aria-hidden`; the `ExactValuesTable` beneath it is the accessible
 * equivalent.
 *
 * Every count column (S/E/agent checks/output quality/time source) renders
 * through `<Reported>`, never '0' for `null` (CLAUDE.md: unknown != zero).
 * Timer flag hits all three tiers on its own: 'OK' is recorded, 'Timing
 * uncertain' is the one uncertain-tier amber mark worth drawing the eye to,
 * 'Not reported' is absent — `Trends.test.tsx` exercises all three at this
 * exact column rather than assuming `<Reported>` gets it right by default.
 *
 * The chart re-encodes planned-vs-completed as an unfilled ruled FRAME
 * (planned, stroke only, the `rule` hairline colour) filled with `ink`
 * (completed) — the same metaphor as the not-a-value ruled slot, arriving
 * independently at the other end of the app (the rework spec §7). Both `<Bar>`
 * elements keep their `dataKey`s (`plannedMinutes`/`completedMinutes`)
 * exactly, since `Trends.test.tsx`'s own recharts mock keys its
 * `bar-<dataKey>` test IDs off them. `completedMinutes` stays `null` (never
 * `0`) for a block that has not ended yet, so an unfinished block draws an
 * empty frame, never a zero-height bar.
 *
 * Recharts is deliberately used only in this feature directory (`no file
 * outside apps/web/src/features/progress imports recharts`, this file's own
 * grep test in `Trends.test.tsx`) — `ResponsiveContainer` is NOT used: it
 * requires `ResizeObserver` to ever report a non-zero size, which jsdom does
 * not implement, so this chart renders at a fixed pixel size inside an
 * `overflow-x-auto` wrapper instead.
 */
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import type { PracticeRowValue } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { Reported } from '../../ui/Reported.js'
import { ExactValuesTable, type ExactValuesTableRow } from './ExactValuesTable.js'
import { formatReportedCount } from './format.js'
import {
  blockOrdinals,
  formatCountMethod,
  formatMinutes,
  formatOutputQuality,
  formatTimerFlag,
  secondsToWholeMinutes,
} from './trendFormat.js'

// the rework spec §7, "The practice bar chart": planned is an unfilled ruled
// frame using the `rule` hairline token; completed fills that same frame
// with `ink`. Never a second categorical hue — planned-vs-completed is a
// target and an actual, not two unrelated series.
const FRAME_COLOR = '#D5DBDA' // rule
const FILL_COLOR = '#16232B' // ink
const AXIS_INK = '#455761' // ink-muted
const GRIDLINE = '#D5DBDA' // rule

const CHART_WIDTH = 640
const CHART_HEIGHT = 240

const COLUMNS = [
  'Day',
  'Date',
  'Block',
  'Planned (min)',
  'Completed (min)',
  'Output quality',
  'S',
  'E',
  'Agent checks',
  'Timer flag',
  'Time source',
] as const

export interface PracticeTrendProps {
  readonly practice: readonly PracticeRowValue[]
}

interface PracticeChartDatum {
  readonly label: string
  readonly plannedMinutes: number
  // `null`, never `0`, for a block that has not ended yet — recharts simply
  // omits the bar for a `null` datum.
  readonly completedMinutes: number | null
}

export function PracticeTrend({ practice }: PracticeTrendProps) {
  const reducedMotion = usePrefersReducedMotion()
  const blocks = blockOrdinals(practice)

  const chartData: PracticeChartDatum[] = practice.map((row) => ({
    // A comma, not a middle dot: the rework spec §4 bans "meta strings joined with
    // middle dots" as a commonest tell of generated design. This axis label
    // is new content this task writes, not preserved legacy text, so it
    // must not introduce the pattern the rule names.
    label: `Day ${row.day}, Block ${blocks.get(row.sessionId) ?? 1}`,
    plannedMinutes: secondsToWholeMinutes(row.targetSeconds),
    completedMinutes: row.completedSeconds == null ? null : secondsToWholeMinutes(row.completedSeconds),
  }))

  const tableRows: ExactValuesTableRow[] = practice.map((row) => ({
    key: row.sessionId,
    cells: [
      row.day,
      row.localDate,
      blocks.get(row.sessionId) ?? 1,
      secondsToWholeMinutes(row.targetSeconds),
      <Reported key="completed">{formatMinutes(row.completedSeconds)}</Reported>,
      <Reported key="quality">{formatOutputQuality(row.outputQuality)}</Reported>,
      <Reported key="s">{formatReportedCount(row.episodeCount)}</Reported>,
      <Reported key="e">{formatReportedCount(row.externalCount)}</Reported>,
      <Reported key="agent">{formatReportedCount(row.unplannedAgentChecks)}</Reported>,
      <Reported key="timer">{formatTimerFlag(row.timerQuality)}</Reported>,
      <Reported key="method">{formatCountMethod(row.countMethod)}</Reported>,
    ],
  }))

  return (
    <section className="flex flex-col gap-3" aria-labelledby="practice-trend-heading">
      <h2 id="practice-trend-heading" className="text-base font-semibold">
        Practice
      </h2>
      <p className="text-sm text-ink-muted">
        Durations vary by design; practice blocks are never compared with the fixed 20-minute benchmark.
      </p>

      {chartData.length > 0 ? (
        <div aria-hidden="true" data-testid="practice-trend-chart" className="overflow-x-auto">
          {/* See DailyTrend.tsx's identical comment: Recharts' root `<svg>`
              defaults to `tabindex="0"`, which — inside this
              `aria-hidden="true"` wrapper — is a Tab stop with no announced
              content (axe's "aria-hidden-focus", WCAG 4.1.2). */}
          <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={chartData} tabIndex={-1}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_INK, fontSize: 11 }} />
            <YAxis
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: AXIS_INK }}
            />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="plannedMinutes"
              name="Planned minutes"
              fill="none"
              stroke={FRAME_COLOR}
              strokeWidth={1.5}
              radius={0}
              isAnimationActive={!reducedMotion}
            />
            <Bar
              dataKey="completedMinutes"
              name="Completed minutes"
              fill={FILL_COLOR}
              radius={0}
              isAnimationActive={!reducedMotion}
            />
          </BarChart>
        </div>
      ) : null}

      <ExactValuesTable
        caption="Practice blocks"
        columns={COLUMNS}
        rows={tableRows}
        emptyMessage="No practice blocks yet."
      />
      <p className="text-xs text-ink-muted">Practice durations and counts are self-reported.</p>
    </section>
  )
}
```

Replace the whole of `apps/web/src/features/progress/DailyTrend.tsx`:

```tsx
/**
 * The Progress report's daily trend section (task 8.8.3), mounted as a
 * child of `ReportSections` in `Progress.tsx`. Pure presentation of
 * `report.days` (`DayRowValue[]`, `packages/shared/src/contracts/
 * report.ts`, 6.2.4) — nothing here derives a value the server did not
 * already send (D4).
 *
 * progress-report spec, "Practice and daily trends are separate sections":
 * daily check-ins show sleep and feed minutes by device; a day with no
 * check-in row at all is a gap ('Not reported'), never a zero. The line
 * chart is `aria-hidden` with `connectNulls={false}` so a missing day is a
 * genuine break in the line, never bridged or read as zero; the
 * `ExactValuesTable` beneath it is the accessible equivalent.
 *
 * Every table cell (status, sleep/mindfulness/feed minutes, stress) renders
 * through `<Reported>` — including stress, which now always formats to a
 * string via `trendFormat.ts`'s `formatStress` instead of the previous
 * inline `day.stress === null ? 'Not reported' : day.stress` (the rework spec §9,
 * defect 5), so it can carry the same tier mark as every other cell instead
 * of rendering as a bare, untiered number.
 *
 * `report.days`'s `DayRowValue` exposes only `feedByDevice`, the per-device
 * MINUTE TOTAL summed across every scope-`feed` row for that day
 * (`services/report/days.ts`'s `mapDayRow` -> `domain/feed.ts`'s
 * `feedAggregates`) — the raw per-row `platform`/`source` detail the
 * check-in form itself captures is reduced away before it reaches this
 * report. So this table shows device totals (each explicitly labelled
 * 'device-minutes') rather than attributing an 'Estimate'/'From device
 * report' source to any specific number, and instead carries a general
 * provenance note naming both sources below the table.
 *
 * Chart palette: sleep keeps its original hue; the four feed-device colours
 * are re-stepped off the app's own `signal`/`attention` tokens so no chart
 * hue collides with what those tokens mean elsewhere (the rework spec §7) — the
 * old tablet yellow in particular sat right beside `attention`'s amber,
 * which would have meant "uncertain" in the interface and "tablet" in a
 * chart three inches away. Grid moves to the `rule` token, axis ticks to
 * `ink-muted`.
 */
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayRowValue, FeedDevice } from '@attention-lab/shared'
import { FEED_DEVICES } from '@attention-lab/shared'

import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { Reported } from '../../ui/Reported.js'
import { ExactValuesTable, type ExactValuesTableRow } from './ExactValuesTable.js'
import {
  FEED_SOURCE_LABEL,
  formatCheckinStatus,
  formatFeedDevice,
  formatMinutes,
  formatStress,
} from './trendFormat.js'

const SLEEP_COLOR = '#2a78d6'
const DEVICE_COLOR: Record<FeedDevice, string> = {
  phone: '#C24E1F',
  desktop: '#157F5C',
  tablet: '#4a3aa7',
  unspecified: '#C85480',
}
const AXIS_INK = '#455761' // ink-muted
const GRIDLINE = '#D5DBDA' // rule

const CHART_WIDTH = 640
const CHART_HEIGHT = 240

const COLUMNS = [
  'Day',
  'Date',
  'Status',
  'Sleep (min)',
  'Mindfulness (min)',
  'Stress',
  'Phone (device-minutes)',
  'Desktop (device-minutes)',
  'Tablet (device-minutes)',
  'Unspecified device (device-minutes)',
  'Feed total (device-minutes)',
] as const

export interface DailyTrendProps {
  readonly days: readonly DayRowValue[]
}

interface DailyChartDatum {
  readonly day: number
  // Every field is `null`, never `0`, for a day with no reported value —
  // `connectNulls={false}` on each `Line` renders that as a real gap.
  readonly sleepMinutes: number | null
  readonly phoneMinutes: number | null
  readonly desktopMinutes: number | null
  readonly tabletMinutes: number | null
  readonly unspecifiedMinutes: number | null
}

export function DailyTrend({ days }: DailyTrendProps) {
  const reducedMotion = usePrefersReducedMotion()

  const chartData: DailyChartDatum[] = days.map((day) => ({
    day: day.day,
    sleepMinutes: day.sleepMinutes,
    phoneMinutes: day.feedByDevice.phone,
    desktopMinutes: day.feedByDevice.desktop,
    tabletMinutes: day.feedByDevice.tablet,
    unspecifiedMinutes: day.feedByDevice.unspecified,
  }))

  const tableRows: ExactValuesTableRow[] = days.map((day) => ({
    key: day.localDate,
    cells: [
      day.day,
      day.localDate,
      <Reported key="status">{formatCheckinStatus(day.status)}</Reported>,
      <Reported key="sleep">{formatMinutes(day.sleepMinutes)}</Reported>,
      <Reported key="mindfulness">{formatMinutes(day.mindfulnessMinutes)}</Reported>,
      <Reported key="stress">{formatStress(day.stress)}</Reported>,
      <Reported key="phone">{formatMinutes(day.feedByDevice.phone)}</Reported>,
      <Reported key="desktop">{formatMinutes(day.feedByDevice.desktop)}</Reported>,
      <Reported key="tablet">{formatMinutes(day.feedByDevice.tablet)}</Reported>,
      <Reported key="unspecified">{formatMinutes(day.feedByDevice.unspecified)}</Reported>,
      <Reported key="total">{formatMinutes(day.feedDeviceMinutes)}</Reported>,
    ],
  }))

  return (
    <section className="flex flex-col gap-3" aria-labelledby="daily-trend-heading">
      <h2 id="daily-trend-heading" className="text-base font-semibold">
        Daily check-ins
      </h2>

      {chartData.length > 0 ? (
        <div aria-hidden="true" data-testid="daily-trend-chart" className="overflow-x-auto">
          {/* `tabIndex={-1}`: Recharts renders its root `<svg>` with
              `tabindex="0"` by default — inside this `aria-hidden="true"`
              wrapper, that gives Tab a stop with no announced content at
              all (axe's "aria-hidden-focus", WCAG 4.1.2). The
              `ExactValuesTable` below is this data's real, focusable,
              accessible form. */}
          <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={chartData} tabIndex={-1}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={(value: number) => `Day ${value}`}
              tick={{ fill: AXIS_INK, fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: AXIS_INK }}
            />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="sleepMinutes"
              name="Sleep"
              stroke={SLEEP_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
            {FEED_DEVICES.map((device) => (
              <Line
                key={device}
                type="monotone"
                dataKey={`${device}Minutes`}
                name={`${formatFeedDevice(device)} feed`}
                stroke={DEVICE_COLOR[device]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </LineChart>
        </div>
      ) : null}

      <ExactValuesTable
        caption="Daily check-ins"
        columns={COLUMNS}
        rows={tableRows}
        emptyMessage="No daily check-ins yet."
      />
      <p className="text-xs text-ink-muted">
        Feed minutes are recorded either as a quick {FEED_SOURCE_LABEL.estimate} or transcribed{' '}
        {FEED_SOURCE_LABEL.device_report}; the totals above combine both. Daily values are self-reported.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- Trends.test.tsx`
Expected: PASS — all of the file's original tests (including the recharts-import grep test, the aria-hidden/tabIndex checks, and the reduced-motion animation check, none of which this task touches) plus the two new tiering tests.

- [ ] **Step 5: Visual check for the frame/fill re-encoding (no meaningful automated test)**
The recharts mock in `Trends.test.tsx` replaces `<Bar>` with a stand-in `<div>` that never reads `fill`/`stroke`/`radius`, so the actual visual shape of the practice chart has no automated coverage — Playwright's real-browser sweep (the rework spec §10's Wave 2) is the only place a real `<rect>` renders.
Run: `npm run dev:web`, then `npm run dev:api` in a second terminal, sign in as the fixed `local-demo` principal, and open `/progress` for a demo scenario with at least one practice block (e.g. the Day 4 fixture referenced in `Progress.test.tsx`'s comments).
Expected on screen: the "Practice" bar chart shows each planned bar as a thin **outlined rectangle with no fill** (the `rule`-coloured frame) and each completed bar as a **solid dark-ink rectangle**, sharing the same category axis position — never two same-weight filled bars in different hues.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/features/progress/ExactValuesTable.tsx apps/web/src/features/progress/PracticeTrend.tsx apps/web/src/features/progress/DailyTrend.tsx apps/web/src/features/progress/trendFormat.ts apps/web/src/features/progress/Trends.test.tsx
git commit -m "$(cat <<'EOF'
Re-palette the trend charts and tier every ExactValuesTable cell

ExactValuesTable moves onto shadcn's table parts with font-mono at the
table level (it IS "the exact-values tables" the mono rule names).
PracticeTrend's planned/completed bars become an unfilled rule-coloured
frame filled with ink, keeping both dataKeys the tests key off. DailyTrend's
feed-device palette is re-stepped away from the signal/attention tokens,
and stress moves off an inline ternary into trendFormat's formatStress so it
can render tiered like every other cell instead of as a bare number.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 49: The wrapper — Progress.tsx wiring, ExportPreview, FormatToggle, ProgressEmptyState

**Files:**
- Modify: `apps/web/src/features/progress/Progress.tsx`
- Modify: `apps/web/src/features/progress/ExportPreview.tsx`
- Modify: `apps/web/src/features/progress/FormatToggle.tsx`
- Modify: `apps/web/src/features/progress/ProgressEmptyState.tsx`
- Test: `apps/web/src/features/progress/Progress.test.tsx`

**Interfaces:**
- Consumes: `Button` (`../../ui/Button.js`, including `asChild`); shadcn `Alert`/`AlertDescription` (`../../ui/shadcn/alert.js`), `Skeleton` (`../../ui/shadcn/skeleton.js`), `RadioGroup`/`RadioGroupItem` (`../../ui/shadcn/radio-group.js`).
- Produces: nothing new for later tasks — this is the last task in the unit.

`ProgressEmptyState`'s Setup link is one of the four call sites the rework spec §6 names by name for the `LINK_CLASSES` retirement ("`NextAction`, `CheckinCard`, `ActiveSessionCard` and `ProgressEmptyState`") — the other three belong to other units' file ownership, so this task only touches its own.

- [ ] **Step 1: Add a regression-guard assertion (this is not a failing test)**

In `apps/web/src/features/progress/Progress.test.tsx`, extend `'GET /programs/current 404 renders the empty state with a Setup link and no numeric cards'`:

```tsx
  it('GET /programs/current 404 renders the empty state with a Setup link and no numeric cards', async () => {
    const error = new NotFoundError(404, {
      code: 'not_found',
      message: 'No program was found.',
      retryable: false,
      requestId: 'req-1',
    })
    mockApi.programs.current.mockRejectedValue(error)

    renderWithProviders(<Progress />)

    const setupLink = await screen.findByRole('link', { name: /setup/i })
    expect(setupLink).toHaveAttribute('href', '/setup')
    // `Button asChild` must render the Radix Slot's CHILD element (the real
    // `<a>`), never a `<button>` wrapping an anchor — the rework spec §12
    // ("Open questions and risks") calls this the highest-risk single change.
    expect(setupLink.tagName).toBe('A')
    expect(setupLink.closest('button')).toBeNull()
    expect(screen.queryByText(/of 2/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
```

This is not a TDD red step. `ProgressEmptyState` today renders a plain, hand-styled `<Link>` — a real anchor — so both new assertions already pass before any code in this task changes. They exist as a regression guard against Step 3's `Button asChild` ever rendering a `<button>` wrapping an `<a>`, the concrete failure mode the rework spec §12 ("Open questions and risks") calls the highest-risk single change, not as a behavior this task is introducing.

- [ ] **Step 2: Run it now and record the passing baseline**
Run: `npm run test -w @attention-lab/web -- Progress.test.tsx`
Expected: PASS, including the two new assertions, before Step 3 touches any source. Re-run the identical command after Step 3 to confirm the guard still passes with `Button asChild` wired in — that second run is the one actually exercising the risk this assertion exists to catch.

- [ ] **Step 3: Implement**

Replace the whole of `apps/web/src/features/progress/ProgressEmptyState.tsx`:

```tsx
/**
 * The Progress screen's neutral empty state (task 8.8.1) — shown whenever
 * there is no program to report on: `GET /programs/current` resolving
 * `program: null` (D22's no-program shape, the actual behavior of the real
 * endpoint) or, defensively, a `NotFoundError` from that same call. No
 * zero-valued card is ever rendered here — there is nothing to measure yet,
 * which is a different state from "measured and zero" (CLAUDE.md: "Unknown
 * != zero").
 *
 * The Setup link uses `Button asChild` (the rework spec §6) rather than a
 * hand-rolled `LINK_CLASSES`-style anchor — `asChild` renders the Radix
 * Slot's CHILD element (the real `<Link>` -> `<a>`), never a `<button>`
 * wrapping an anchor, so `getByRole('link', { name: 'Go to Setup' })` keeps
 * resolving to a real anchor with a real `href`.
 */
import { Link } from 'react-router'

import { Button } from '../../ui/Button.js'

export function ProgressEmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Progress</h1>
      <p className="text-ink">There is nothing to report yet. Set up your program to start your baseline.</p>
      <Button asChild className="self-start">
        <Link to="/setup">Go to setup</Link>
      </Button>
    </div>
  )
}
```

Replace the whole of `apps/web/src/features/progress/FormatToggle.tsx`:

```tsx
/**
 * CSV | Markdown format toggle for `ExportPreview` (task 8.8.4). A plain
 * two-option shadcn `RadioGroup` (mutually exclusive selection, not a
 * submit action) — each option's accessible name comes from a sibling
 * `<label htmlFor>` since Radix's `RadioGroupItem` renders a
 * `button[role="radio"]`, which does not pick up a wrapping `<label>` the
 * way a native input does.
 */
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'

export type ExportFormat = 'csv' | 'markdown'

const OPTIONS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'Markdown' },
]

export interface FormatToggleProps {
  readonly value: ExportFormat
  readonly onChange: (format: ExportFormat) => void
}

export function FormatToggle({ value, onChange }: FormatToggleProps) {
  return (
    <RadioGroup
      className="flex gap-4"
      value={value}
      onValueChange={(next) => onChange(next as ExportFormat)}
      aria-label="Export format"
    >
      {OPTIONS.map((option) => {
        const id = `export-format-${option.value}`
        return (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem id={id} value={option.value} />
            <label htmlFor={id} className="text-sm text-ink">
              {option.label}
            </label>
          </div>
        )
      })}
    </RadioGroup>
  )
}
```

Edit `apps/web/src/features/progress/ExportPreview.tsx`:

```diff
 import { useState } from 'react'
 import { useQuery } from '@tanstack/react-query'
 import { localDateAt } from '@attention-lab/shared'

 import { api } from '../../lib/api/client.js'
 import { Button } from '../../ui/Button.js'
+import { Alert, AlertDescription } from '../../ui/shadcn/alert.js'
+import { Skeleton } from '../../ui/shadcn/skeleton.js'
 import { FormatToggle } from './FormatToggle.js'
 import type { ExportFormat } from './FormatToggle.js'
```

```diff
       <FormatToggle value={format} onChange={setFormat} />

-      <p className="text-sm text-[var(--color-text-muted)]">Not-reported values are exported as empty cells.</p>
+      <p className="text-sm text-ink-muted">Not-reported values are exported as empty cells.</p>

       {exportQuery.isPending ? (
-        <div aria-busy="true">Loading export preview</div>
+        <div aria-busy="true" className="flex flex-col gap-2">
+          <Skeleton className="h-4 w-40" />
+          <Skeleton className="h-32 w-full" />
+        </div>
       ) : exportQuery.isError || text === undefined ? (
-        <div>
-          <p>Export unavailable. Retry.</p>
-          <Button
-            onClick={() => {
-              void exportQuery.refetch()
-            }}
-          >
-            Retry
-          </Button>
-        </div>
+        <Alert role="alert">
+          <AlertDescription className="flex items-center justify-between gap-3">
+            <span>Export unavailable. Retry.</span>
+            <Button
+              onClick={() => {
+                void exportQuery.refetch()
+              }}
+            >
+              Retry
+            </Button>
+          </AlertDescription>
+        </Alert>
       ) : (
         <>
-          <p data-testid="export-label-line" className="text-sm font-medium text-[var(--color-text)]">
+          <p data-testid="export-label-line" className="text-sm font-medium text-ink">
             {firstLine}
           </p>
           {/* See ExactValuesTable.tsx's identical comment: `tabIndex={0}` for
               axe's "scrollable-region-focusable" (WCAG 2.1.1); no
               `role="region"` (a named landmark here would repeat "Export",
               already this section's own `aria-labelledby` name, and could
               collide the same way the table wrappers' did in practice). */}
           <div
-            className="overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
+            className="overflow-x-auto rounded border border-rule bg-card p-3"
             tabIndex={0}
           >
+            {/* Deliberately NOT font-mono: mono is restricted to timer
+                digits, exact-values tables and comparison figures
+                (the rework spec §4, "and no others") — a raw CSV/Markdown text
+                dump is none of those three, however monospace-friendly it
+                looks. */}
             <pre data-testid="export-preview-text" className="whitespace-pre text-xs">
               {text}
             </pre>
           </div>
           <Button
             variant="secondary"
             onClick={() => {
               downloadText(text, format)
             }}
           >
             Download
           </Button>
         </>
       )}
```

Edit `apps/web/src/features/progress/Progress.tsx`:

```diff
 import { useQuery } from '@tanstack/react-query'
 import type { ReportResponseValue } from '@attention-lab/shared'

 import { api } from '../../lib/api/client.js'
 import { NotFoundError, ValidationError } from '../../lib/api/errors.js'
 import { queryKeys } from '../../lib/query/keys.js'
 import { Button } from '../../ui/Button.js'
+import { Alert, AlertDescription } from '../../ui/shadcn/alert.js'
+import { Skeleton } from '../../ui/shadcn/skeleton.js'
 import { AttemptTable, type AttemptTableRow } from './AttemptTable.js'
```

```diff
   if (reportQuery.isPending) {
-    return <div aria-busy="true">Loading report</div>
+    return (
+      <div aria-busy="true" className="flex flex-col gap-3">
+        <Skeleton className="h-4 w-48" />
+        <Skeleton className="h-24 w-full" />
+        <Skeleton className="h-24 w-full" />
+      </div>
+    )
   }

   if (reportQuery.isError || reportQuery.data === undefined) {
-    // 422 realm mixing: the fixed server message, no partial table (identity-realm:
-    // "Realms are never mixed in a result" — a mixed report is never rendered half-built).
+    // 422 realm mixing: the fixed server message, no partial table
+    // (identity-realm: "Realms are never mixed in a result" — a mixed
+    // report is never rendered half-built). Neutral treatment, never
+    // `variant="destructive"`: the rework spec §3 scopes the destructive token
+    // strictly to destructive ACTIONS, and states outright that a 422
+    // realm mismatch, a 409 conflict, a failed save and a validation
+    // message all "render neutrally, in ink, keeping their existing
+    // role='alert'" — the same default-variant `Alert` as the retry banner
+    // just below.
     if (reportQuery.error instanceof ValidationError) {
       return (
-        <div role="alert">
-          <p>{reportQuery.error.message}</p>
-        </div>
+        <Alert role="alert">
+          <AlertDescription>{reportQuery.error.message}</AlertDescription>
+        </Alert>
       )
     }
     return (
-      <div>
-        <p>Report unavailable. Retry.</p>
-        <Button
-          onClick={() => {
-            void reportQuery.refetch()
-          }}
-        >
-          Retry
-        </Button>
-      </div>
+      <Alert role="alert">
+        <AlertDescription className="flex items-center justify-between gap-3">
+          <span>Report unavailable. Retry.</span>
+          <Button
+            onClick={() => {
+              void reportQuery.refetch()
+            }}
+          >
+            Retry
+          </Button>
+        </AlertDescription>
+      </Alert>
     )
   }

   const report = reportQuery.data

   return (
     <div className="flex flex-col gap-6">
-      <p className="text-sm text-[var(--color-text-muted)]">{formatRealm(report.realm)}</p>
+      <p className="text-sm text-ink-muted">{formatRealm(report.realm)}</p>
```

```diff
 export function Progress() {
   const currentQuery = useQuery({
     queryKey: queryKeys.programs.current,
     queryFn: api.programs.current,
   })

   if (currentQuery.isPending) {
-    return <div aria-busy="true">Loading</div>
+    return (
+      <div aria-busy="true" className="flex flex-col gap-3">
+        <Skeleton className="h-6 w-32" />
+        <Skeleton className="h-24 w-full" />
+      </div>
+    )
   }

   if (currentQuery.isError || currentQuery.data === undefined) {
     if (currentQuery.error instanceof NotFoundError) {
       return <ProgressEmptyState />
     }
     return (
-      <div>
-        <p>Report unavailable. Retry.</p>
-        <Button
-          onClick={() => {
-            void currentQuery.refetch()
-          }}
-        >
-          Retry
-        </Button>
-      </div>
+      <Alert role="alert">
+        <AlertDescription className="flex items-center justify-between gap-3">
+          <span>Report unavailable. Retry.</span>
+          <Button
+            onClick={() => {
+              void currentQuery.refetch()
+            }}
+          >
+            Retry
+          </Button>
+        </AlertDescription>
+      </Alert>
     )
   }
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- Progress.test.tsx ExportPreview.test.tsx`
Expected: PASS — every existing test in both files (including `ExportPreview.test.tsx`'s `'error renders Export unavailable with Retry'`, which needed no edit since `findByText('Export unavailable. Retry.')` still matches the `<span>` inside the new `Alert`) plus the two new assertions on the Setup link's real-anchor shape.

Run the full unit once more end to end:
Run: `npm run test -w @attention-lab/web -- features/progress`
Expected: PASS across every test file this unit owns (`Progress.test.tsx`, `ResultState.test.tsx`, `Trends.test.tsx`, `ExportPreview.test.tsx`, `AmendmentDialog.test.tsx`).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/progress/Progress.tsx apps/web/src/features/progress/ExportPreview.tsx apps/web/src/features/progress/FormatToggle.tsx apps/web/src/features/progress/ProgressEmptyState.tsx apps/web/src/features/progress/Progress.test.tsx
git commit -m "$(cat <<'EOF'
Wire Progress.tsx's chrome onto Skeleton/Alert; retire ProgressEmptyState's LINK_CLASSES

Loading states become static Skeleton slots (never pulsing), and every
retry/error state -- including the 422 realm-mismatch refusal -- becomes the
neutral default-variant Alert; the rework spec §3 scopes variant="destructive" to
destructive actions only, never an error banner. FormatToggle moves onto the
shadcn RadioGroup. ProgressEmptyState's Setup link moves onto Button
asChild, one of the four LINK_CLASSES call sites the rework spec §6 names by name
— with a regression guard pinning it to a real <a>, never a button wrapping
one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

## Unit: Research and settings

### Task 50: Research cards — new tokens, no middle-dot meta strings

The `var(--color-*)` custom properties this unit's files still reference no longer exist after Wave
0. `ResearchCard.tsx` also renders two middle-dot meta strings (`{authors} · {year}` and
`{peerReview} · {reviewed}`), and `ResearchCards.tsx`'s header renders a third
(`Curated demonstration content · curated {date}`) that is asserted verbatim by an existing test.
The Finding/Limitation/Relevance `<dl>` already gives its limitation the same visual weight as its
finding (same `dt`/`dd` classes) — that part needs only a token swap, not a restructure. The boxed
`rounded-lg border ... bg-surface` treatment on each card is the "Card as a default wrapper" pattern
the design explicitly retires; each card becomes a hairline-separated log entry instead, and the
hairline has to live on the `<li>` (true siblings in the list), not on the `<article>` itself (which
is always its `<li>`'s only, and therefore always "last", child).

**Files:**
- Modify: `apps/web/src/features/research/ResearchCard.tsx`
- Modify: `apps/web/src/features/research/ResearchCards.tsx`
- Modify: `apps/web/src/features/research/ResearchCards.test.tsx`

**Interfaces:**
- Consumes: nothing from the frozen list — this task is pure token/markup cleanup, no new primitives.
- Produces: nothing — leaf task. `ResearchCard`'s and `ResearchCards`' exported signatures are unchanged.

- [ ] **Step 1: Write the failing test**
Edit `apps/web/src/features/research/ResearchCards.test.tsx`: change the existing exact-string
assertion to the middle-dot-free copy, and add a new regression test that no middle-dot character
appears anywhere on the screen (the current header line still emits one, so both fail together).

```tsx
  it('shows the curation date and Automated discovery not enabled', async () => {
    mount()

    await screen.findAllByRole('article')
    expect(screen.getByText(`Curated demonstration content, curated ${RESEARCH_CURATED_ON}`)).toBeInTheDocument()
    expect(screen.getByText('Automated discovery not enabled')).toBeInTheDocument()
  })

  it('never renders a middle-dot meta string anywhere on the screen', async () => {
    const { container } = mount()

    await screen.findAllByRole('article')
    expect(container.textContent ?? '').not.toContain('·')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- ResearchCards.test`
Expected: FAIL — `shows the curation date and Automated discovery not enabled` fails on its first
assertion because the rendered text is still `Curated demonstration content · curated 2026-09-01`
(comma expected, dot found); `never renders a middle-dot meta string anywhere on the screen` fails
because `container.textContent` still contains `·` — once from the header line, and twice from
each of the three rendered `ResearchCard`s (`{authors} · {year}` and `{peerReview} · {reviewed}`) —
seven occurrences in total.

- [ ] **Step 3: Implement**

Replace `apps/web/src/features/research/ResearchCard.tsx`:

```tsx
import type { ResearchCardValue } from '@attention-lab/shared'

/**
 * One curated evidence card (research-cards: every card SHALL show title,
 * authors and year, study design, provenance, one finding, one limitation,
 * one relevance note, and the original source link). Finding and
 * Limitation share the same `dt`/`dd` treatment deliberately — a study's
 * limitation carries the same visual weight as its finding, never demoted
 * to fine print.
 */
export interface ResearchCardProps {
  readonly card: ResearchCardValue
}

const PEER_REVIEW_LABEL: Record<ResearchCardValue['provenance']['peerReview'], string> = {
  peer_reviewed: 'Peer-reviewed',
  preprint: 'Preprint',
  unknown: 'Peer-review status unknown',
}

const REVIEWED_LABEL: Record<ResearchCardValue['provenance']['reviewed'], string> = {
  full_text: 'Full text reviewed',
  abstract: 'Abstract reviewed',
}

/**
 * research-cards: "External sources open deliberately" — SHALL accept only
 * HTTP(S) URLs. `new URL()` throws on a malformed string (not only on a
 * non-http(s) scheme like `javascript:`), so both cases fall through to
 * `false` here rather than throwing out of the render.
 */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function ResearchCard({ card }: ResearchCardProps) {
  const sourceIsHttp = isHttpUrl(card.sourceUrl)

  return (
    <article className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{card.title}</h2>
        <p className="text-sm text-ink-muted">
          {card.authors}, {card.year}
        </p>
      </div>

      <p className="text-sm text-ink-muted">{card.studyDesign}</p>

      <p className="text-sm text-ink-muted">
        {PEER_REVIEW_LABEL[card.provenance.peerReview]}, {REVIEWED_LABEL[card.provenance.reviewed]}
      </p>

      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="font-medium text-ink">Finding</dt>
          <dd className="text-ink-muted">{card.finding}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Limitation</dt>
          <dd className="text-ink-muted">{card.limitation}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Relevance here</dt>
          <dd className="text-ink-muted">{card.relevance}</dd>
        </div>
      </dl>

      {sourceIsHttp ? (
        <a
          href={card.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-sm font-medium text-signal underline underline-offset-2"
        >
          Read source
        </a>
      ) : (
        <span className="text-sm text-ink-muted">Source link unavailable</span>
      )}
    </article>
  )
}
```

Replace `apps/web/src/features/research/ResearchCards.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { ResearchCard } from './ResearchCard.js'

/**
 * The Research screen, mounted at `/research` under `RailLayout`.
 * research-cards: "Three finite curated cards" — exactly three cards, no
 * pagination, no load-more, no refetch interval; "Content is labeled as
 * demonstration content" — the curation date plus "Automated discovery not
 * enabled" is always shown.
 *
 * `GET /research/cards` is a static fixture, not a feed: `staleTime:
 * Infinity` and `refetchInterval: false` mean it is fetched once per app
 * session and never polled, `refetchOnWindowFocus: false` keeps returning to
 * the tab from being read as a reason to refresh it, and `retry: false`
 * turns a failure into a single terse message rather than a retry loop.
 *
 * Each card is a hairline-separated log entry, not a boxed card — the
 * hairline lives on the `<li>` (true list siblings), not inside
 * `ResearchCard` itself.
 */
export function ResearchCards() {
  const query = useQuery({
    queryKey: queryKeys.research.cards,
    queryFn: api.research.cards,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Research</h1>
        {query.data ? (
          <p className="text-sm text-ink-muted">Curated demonstration content, curated {query.data.curatedOn}</p>
        ) : null}
        {query.data ? <p className="text-sm text-ink-muted">{query.data.discoveryNote}</p> : null}
        {query.data ? <p className="text-sm text-ink-muted">{query.data.note}</p> : null}
      </header>

      {query.isError ? (
        <p role="alert" className="text-sm">
          Cards unavailable
        </p>
      ) : null}

      {query.data ? (
        <ul className="flex flex-col" aria-label="Curated research cards">
          {query.data.cards.map((card) => (
            <li key={card.id} className="border-b border-rule py-6 first:pt-0 last:border-b-0 last:pb-0">
              <ResearchCard card={card} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- ResearchCards.test`
Expected: PASS — all 8 cases (the original 7 — one of them, "shows the curation date...", now
carrying the updated comma-separated assertion — plus the new middle-dot regression test).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/research/ResearchCard.tsx apps/web/src/features/research/ResearchCards.tsx apps/web/src/features/research/ResearchCards.test.tsx
git commit -m "$(cat <<'EOF'
Move Research cards onto the instrument-log tokens

Replace the retired --color-* custom properties with ink/ink-muted/rule/
signal, drop the boxed card-as-wrapper treatment for a hairline-separated
list, and rewrite the three middle-dot meta strings as plain clauses
(design.md's prohibited-typography rule). The isError line stays
unstyled ink (design.md section 3: an error state is neutral, never the
amber "uncertain" mark and never destructive/red).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 51: Settings composition — one primary action, Preferences section on shared primitives

`Settings.tsx` composes `Preferences` and `ChangePracticeDuration`, and both default their own Save
button to `variant="primary"` — composed together that is two primaries on one screen, which the
app-wide "one primary per interactive surface" rule forbids. `ChangePracticeDuration` gains an
optional `saveVariant` prop (default `'primary'`, so its own standalone test — which asserts exactly
one primary when mounted alone — keeps passing unmodified) and `Settings.tsx` passes
`saveVariant="secondary"` when composing it below `Preferences`, whose Save stays the page's one
primary action. Alongside that, `PreferenceSwitch` moves onto the generated `Switch` primitive,
`TimezoneSelect` moves its id/`aria-describedby`/`aria-invalid` wiring onto `useField` (it already
computed that wiring by hand correctly — this trades the hand-rolled version for the shared one, it
does not fix a bug), and every remaining `var(--color-*)` reference in this file group is converted.
`TimezoneSelect` deliberately keeps its native `<select>` rather than moving to the generated `Select`
primitive: the option list can be several hundred IANA zone names, `Preferences.test.tsx` drives it
with `user.selectOptions`/`toHaveValue`, and Radix's `Select` does not render a native `<select>` — so
converting it would trade a working, appropriately-sized control for a heavier one and a rewritten
test, for no benefit this screen critique asked for.

**Files:**
- Modify: `apps/web/src/features/settings/Settings.tsx`
- Modify: `apps/web/src/features/settings/Preferences.tsx`
- Modify: `apps/web/src/features/settings/PreferenceSwitch.tsx`
- Modify: `apps/web/src/features/settings/TimezoneSelect.tsx`
- Modify: `apps/web/src/features/settings/EditMaterialsLink.tsx`
- Modify: `apps/web/src/features/settings/ChangePracticeDuration.tsx` (adds the `saveVariant` prop only — its `DurationField`/reason-input internals are Task 52's)
- Modify: `apps/web/src/features/settings/ChangePracticeDuration.test.tsx` (one new case)
- Test: Create `apps/web/src/features/settings/Settings.test.tsx`

**Interfaces:**
- Consumes: `Button`/`ButtonVariant` from `@/ui/Button.js`; `useField` from `@/ui/field.js`;
  `Label` from `@/ui/shadcn/label.js`; `Switch` from `@/ui/shadcn/switch.js`.
- Produces: `ChangePracticeDurationProps { readonly saveVariant?: ButtonVariant }` — the exported prop
  Task 52 must preserve when it reworks this same component's internals.

- [ ] **Step 1: Write the failing test**
Create `apps/web/src/features/settings/Settings.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { CurrentProgramResponseValue, MeResponseValue } from '@attention-lab/shared'

import { respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { Settings } from './Settings.js'

// Mirrors DemoControls.test.tsx's own rationale: jsdom has no
// ResizeObserver/hasPointerCapture/scrollIntoView, and Radix's Select
// (reached here through DemoControls -> ScenarioLoader in local-demo mode)
// needs all three whenever it measures itself.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
if (typeof window !== 'undefined') {
  if (typeof window.HTMLElement.prototype.hasPointerCapture !== 'function') {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
}

afterEach(() => {
  cleanup()
})

const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo-principal',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'America/New_York',
  preferences: {
    hideTimerDefault: false,
    endChime: true,
    visibilityContext: false,
    milestoneAnnouncements: false,
  },
  demoClockOffsetSeconds: 0,
}

const ME_REAL: MeResponseValue = { ...ME_LOCAL_DEMO, identityMode: 'real', realm: 'pilot' }

const NO_PROGRAM: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

function activeProgramResponse(): CurrentProgramResponseValue {
  return {
    program: {
      id: 'program-1',
      realm: 'demo',
      status: 'active',
      baselineDate: '2026-09-01',
      timezone: 'America/New_York',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'revision-1',
      version: 1,
    },
    revision: {
      id: 'revision-1',
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    slots: [],
    day: 8,
    nextAction: { kind: 'practice', block: 1 },
  }
}

function mount(me: MeResponseValue, program: CurrentProgramResponseValue = NO_PROGRAM) {
  respond('me.get', me)
  respond('programs.current', program)
  return renderWithProviders(<Settings />)
}

describe('Settings', () => {
  it('renders exactly one primary action across the composed Preferences and Change practice duration sections', async () => {
    const { container } = mount(ME_REAL, activeProgramResponse())

    await screen.findByLabelText('Timezone')
    await screen.findByRole('radio', { name: '15 minutes' })

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveTextContent('Save preferences')
  })

  it('does not render Demo controls for a real-identity principal', async () => {
    mount(ME_REAL)

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.queryByText('Demonstration controls')).not.toBeInTheDocument()
  })

  it('renders Demo controls for a local-demo principal', async () => {
    mount(ME_LOCAL_DEMO)

    expect(await screen.findByRole('heading', { name: 'Demonstration controls' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- Settings.test`
Expected: FAIL — `renders exactly one primary action...` fails with `Expected length: 1, Received
length: 2` (today `ChangePracticeDuration` has no `saveVariant` prop at all, so both it and
`Preferences` render `data-variant="primary"`). The other two cases already pass against the
unmodified component and keep passing throughout.

- [ ] **Step 3: Implement**

Edit `apps/web/src/features/settings/ChangePracticeDuration.tsx` — add the prop and thread it to the
Save button (its `DurationField` and reason-input internals are untouched here, Task 52's job):

```diff
-import { Button } from '../../ui/Button.js'
+import { Button, type ButtonVariant } from '../../ui/Button.js'
```
```diff
-export function ChangePracticeDuration() {
+export interface ChangePracticeDurationProps {
+  /**
+   * Demoted to 'secondary' when Settings.tsx composes this panel below
+   * Preferences, whose own Save stays the page's one primary action.
+   * Defaults to 'primary' so this panel keeps a primary Save when tested
+   * or reached standalone (design.md: "one primary per interactive
+   * surface").
+   */
+  readonly saveVariant?: ButtonVariant
+}
+
+export function ChangePracticeDuration({ saveVariant = 'primary' }: ChangePracticeDurationProps = {}) {
```
```diff
-        <h2 className="text-sm font-semibold text-[var(--color-text)]">Change practice duration</h2>
+        <h2 className="text-sm font-semibold text-ink">Change practice duration</h2>
```
The `banner` paragraph carries both the 422 message and the generic "Could not save. Retry."
fallback — both are a failed save the user must act on, so per the settled colour rule it takes
`attention`, not neutral ink:

```diff
-        {banner !== null ? (
-          <p role="alert" className="text-sm">
-            {banner}
-          </p>
-        ) : null}
+        {banner !== null ? (
+          <p role="alert" className="text-sm text-attention">
+            {banner}
+          </p>
+        ) : null}
```

`successNotice` is left exactly as it is — "Practice duration updated for today onward." is a
recorded, informational confirmation, not a value the app is unsure of or a message demanding
action, so it keeps plain ink with no token. Only the Save button itself changes otherwise, to
thread the new prop through:

```diff
-        <Button type="submit" disabled={!dirty || createRevision.isPending}>
+        <Button type="submit" variant={saveVariant} disabled={!dirty || createRevision.isPending}>
           Save
         </Button>
```

Add one case to `apps/web/src/features/settings/ChangePracticeDuration.test.tsx` (after "Submit is the
only primary action on the panel"). The pre-existing "Submit is the only primary action on the panel"
test already covers the untouched default (`mount()` with no `saveVariant` prop, asserting
`data-variant="primary"`), so the only new case needed is the override itself:

```tsx
  it('renders the demoted Save button when saveVariant is set to secondary', async () => {
    respond('programs.current', activeProgramResponse())
    renderWithProviders(<ChangePracticeDuration saveVariant="secondary" />)

    const button = await screen.findByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('data-variant', 'secondary')
  })
```

Edit `apps/web/src/features/settings/Settings.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { ChangePracticeDuration } from './ChangePracticeDuration.js'
import { DemoControls } from './DemoControls.js'
import { Preferences } from './Preferences.js'

function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">Settings could not be loaded</p>
      <Button
        onClick={() => {
          onRetry()
        }}
      >
        Retry
      </Button>
    </div>
  )
}

/**
 * The Settings screen, mounted at `/settings` under `RailLayout`. Fetches
 * `GET /me` and hands the resolved value to `Preferences`, which owns the
 * draft state and its own mutation.
 *
 * `Preferences`' Save stays the page's one primary action; `
 * ChangePracticeDuration` composes below it with `saveVariant="secondary"`
 * so the two sections never present two primaries on the same screen
 * (the rework spec §6, "One primary per interactive surface").
 *
 * `ChangePracticeDuration` is always reachable while a program is open, so
 * it is not gated on `identityMode`. `DemoControls` mounts only in
 * local-demo mode, matching its own internal self-guard (defense-in-depth,
 * mirroring `DemoBanner.tsx`'s pattern).
 */
export function Settings() {
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: api.me.get })

  if (meQuery.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (meQuery.isError || meQuery.data === undefined) {
    return (
      <RetryNotice
        onRetry={() => {
          void meQuery.refetch()
        }}
      />
    )
  }

  const me = meQuery.data

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
      </header>

      <Preferences me={me} />

      <ChangePracticeDuration saveVariant="secondary" />

      {me.identityMode === 'local-demo' ? (
        <section aria-label="Demo controls" className="flex flex-col gap-6 border-t border-rule pt-6">
          <DemoControls me={me} />
        </section>
      ) : null}
    </div>
  )
}
```

Edit `apps/web/src/features/settings/Preferences.tsx` (token conversion, plus the one real colour
change in this file — `saveFailed`'s banner. Per the settled colour rule, `attention` marks a MESSAGE
the user must act on, not only an uncertain value, so a failed save takes `attention`, not neutral
ink):

```diff
-      <div className="flex flex-col divide-y divide-[var(--color-border)]">
+      <div className="flex flex-col divide-y divide-rule">
```

```diff
-      {saveFailed ? (
-        <p role="alert" className="text-sm">
-          Could not save. Retry.
-        </p>
-      ) : null}
+      {saveFailed ? (
+        <p role="alert" className="text-sm text-attention">
+          Could not save. Retry.
+        </p>
+      ) : null}
```

Replace `apps/web/src/features/settings/PreferenceSwitch.tsx`:

```tsx
import { useId } from 'react'

import { Label } from '../../ui/shadcn/label.js'
import { Switch } from '../../ui/shadcn/switch.js'

/**
 * One labeled toggle row. `label` is associated via a real `<label htmlFor>`
 * so `getByRole('switch', { name: label })` finds it directly, and
 * `description` is wired through `aria-describedby` rather than folded into
 * the accessible name.
 */
export interface PreferenceSwitchProps {
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
}

export function PreferenceSwitch({ label, description, checked, onCheckedChange, disabled }: PreferenceSwitchProps) {
  const switchId = useId()
  const descriptionId = useId()

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={switchId} className="text-sm font-medium text-ink">
          {label}
        </Label>
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={descriptionId}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}
```

Replace `apps/web/src/features/settings/TimezoneSelect.tsx`:

```tsx
import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * The timezone picker on Settings. Purely presentational: the caller
 * (`Preferences.tsx`) owns the value, the candidate zone list and any field
 * error. Stays a native `<select>` rather than the generated Select
 * primitive — the option list can be several hundred IANA zone names, and
 * `user.selectOptions`/`toHaveValue` in `Preferences.test.tsx` exercise it
 * as a native control.
 *
 * The helper copy is a fixed string program-setup's decision record
 * requires verbatim — timezone corrections must never read as "your
 * program restarts."
 */
const HELPER_TEXT = 'Changing your timezone does not move program days'

export function listTimezones(current: string): string[] {
  try {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return zones.includes(current) ? zones : [current, ...zones]
  } catch {
    return [current]
  }
}

export interface TimezoneSelectProps {
  readonly value: string
  readonly zones: readonly string[]
  readonly onChange: (value: string) => void
  readonly error?: string
}

export function TimezoneSelect({ value, zones, onChange, error }: TimezoneSelectProps) {
  const field = useField({ name: 'timezone', description: HELPER_TEXT, error: error ?? null })

  return (
    <div className="flex flex-col gap-2">
      <Label {...field.labelProps} className="text-sm font-medium text-ink">
        Timezone
      </Label>
      <select
        {...field.controlProps}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="min-h-11 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {field.descriptionProps !== undefined ? (
        <p {...field.descriptionProps} className="text-sm text-ink-muted">
          {HELPER_TEXT}
        </p>
      ) : null}
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

Edit `apps/web/src/features/settings/EditMaterialsLink.tsx`:

```diff
-      className="text-sm font-medium text-[var(--color-primary)] underline underline-offset-2"
+      className="text-sm font-medium text-signal underline underline-offset-2"
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- Settings.test`
Run: `npm run test -w @attention-lab/web -- ChangePracticeDuration.test`
Run: `npm run test -w @attention-lab/web -- Preferences.test`
Expected: PASS — all 3 new `Settings.test.tsx` cases, all 9 `ChangePracticeDuration.test.tsx` cases
(8 original + 1 new), and all 8 `Preferences.test.tsx` cases (unmodified, still passing — the
`TimezoneSelect`/`PreferenceSwitch` rewrites preserve every accessible name and role they exercise).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/settings/Settings.tsx apps/web/src/features/settings/Settings.test.tsx apps/web/src/features/settings/Preferences.tsx apps/web/src/features/settings/PreferenceSwitch.tsx apps/web/src/features/settings/TimezoneSelect.tsx apps/web/src/features/settings/EditMaterialsLink.tsx apps/web/src/features/settings/ChangePracticeDuration.tsx apps/web/src/features/settings/ChangePracticeDuration.test.tsx
git commit -m "$(cat <<'EOF'
Keep Settings to one primary action and move Preferences onto shared primitives

ChangePracticeDuration gains a saveVariant override so Settings can demote
it to 'secondary' below Preferences' Save, the page's one primary action.
PreferenceSwitch and TimezoneSelect move onto the generated Switch and
useField wiring, and every --color-* reference in this group converts to
the new tokens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 52: Change practice duration — an ARIA radiogroup and a Field-wired reason input

`DurationField` is five raw `<input type="radio">` elements inside a `<fieldset>`; a `<fieldset>`
has an implicit ARIA role of `group`, not `radiogroup`, so nothing here currently exposes a radio
group to assistive tech beyond the individual radios themselves. This task moves it onto the
generated `RadioGroup`/`RadioGroupItem` primitives (Radix's `RadioGroupPrimitive.Root` does render
`role="radiogroup"`), wires an explicit `aria-labelledby` from the fieldset's own legend so the group
itself gets a real accessible name, and moves the reason `<input>` onto `useField` + the generated
`Input`/`Label` the same way Task 51 did for `TimezoneSelect`. The exact 422 banner string —
`"This program day has already passed; changes apply from today onward"` — is untouched character
for character; `ChangePracticeDuration.test.tsx:192` asserts it verbatim.

**Files:**
- Modify: `apps/web/src/features/settings/ChangePracticeDuration.tsx`
- Modify: `apps/web/src/features/settings/ChangePracticeDuration.test.tsx`

**Interfaces:**
- Consumes: `useField` from `@/ui/field.js`; `Label` from `@/ui/shadcn/label.js`; `Input` from
  `@/ui/shadcn/input.js`; `RadioGroup`/`RadioGroupItem` from `@/ui/shadcn/radio-group.js`; the
  `saveVariant` prop this task's own file already carries from Task 51.
- Produces: nothing new — leaf task relative to the rest of the plan.

- [ ] **Step 1: Write the failing test**
Add to `apps/web/src/features/settings/ChangePracticeDuration.test.tsx` (after "loads the current
governing practiceTargetSeconds as the default"):

```tsx
  it('the duration options form an ARIA radiogroup labelled by the fieldset legend', async () => {
    mount(activeProgramResponse())

    await screen.findByRole('radio', { name: '15 minutes' })
    expect(screen.getByRole('radiogroup', { name: 'New practice duration' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- ChangePracticeDuration.test`
Expected: FAIL — `Unable to find an accessible element with the role "radiogroup" and name "New
practice duration"`. Today's `<fieldset>` exposes role `group`, not `radiogroup`, and nothing points
an `aria-labelledby` at the legend.

- [ ] **Step 3: Implement**

Add four new imports after the existing `import { Button, type ButtonVariant } from '../../ui/Button.js'`
line (the `react`/`@tanstack/react-query`/`@attention-lab/shared`/`api`/`queryKeys` imports above it are
untouched — `useId` stays imported for `DurationField`'s own `legendId`, so nothing there changes):

```tsx
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'
```

Replace `DurationField`:

```tsx
interface DurationFieldProps {
  readonly value: number
  readonly onChange: (seconds: number) => void
}

/** The five practice durations a revision may set (300..1500 s, step 300), rendered as their minute labels. */
function DurationField({ value, onChange }: DurationFieldProps) {
  const legendId = useId()

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={legendId} className="text-sm font-medium text-ink">
        New practice duration
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        value={String(value)}
        onValueChange={(next) => {
          onChange(Number(next))
        }}
        className="flex flex-wrap gap-4"
      >
        {DURATION_OPTIONS.map((option) => {
          const optionId = `change-practice-duration-${option.seconds}`
          return (
            <div key={option.minutes} className="flex items-center gap-2">
              <RadioGroupItem id={optionId} value={String(option.seconds)} />
              <Label htmlFor={optionId} className="text-sm font-normal text-ink">
                {option.minutes} minutes
              </Label>
            </div>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}
```

Replace the reason field block inside `ChangePracticeDuration`'s return:

```diff
-        <div className="flex flex-col gap-2">
-          <label htmlFor={reasonId} className="text-sm font-medium">
-            Reason for change
-          </label>
-          <input
-            id={reasonId}
-            type="text"
-            value={reason}
-            onChange={(event) => {
-              setReason(event.target.value)
-            }}
-            aria-invalid={reasonError !== undefined ? true : undefined}
-            aria-describedby={reasonError !== undefined ? reasonErrorId : undefined}
-            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
-          />
-          {reasonError !== undefined ? (
-            <p id={reasonErrorId} role="alert" className="text-sm">
-              {reasonError}
-            </p>
-          ) : null}
-        </div>
+        <div className="flex flex-col gap-2">
+          <Label {...reasonField.labelProps} className="text-sm font-medium text-ink">
+            Reason for change
+          </Label>
+          <Input
+            {...reasonField.controlProps}
+            type="text"
+            value={reason}
+            onChange={(event) => {
+              setReason(event.target.value)
+            }}
+          />
+          {reasonField.errorProps !== undefined ? (
+            <p {...reasonField.errorProps} className="text-sm">
+              {reasonError}
+            </p>
+          ) : null}
+        </div>
```

And, near the top of `ChangePracticeDuration` (replacing the now-unused `reasonId`/`reasonErrorId`
locals — `useId` stays imported for `DurationField`'s own `legendId`):

```diff
-  const reasonId = useId()
-  const reasonErrorId = useId()
+  const reasonField = useField({ name: 'change-practice-duration-reason', error: reasonError ?? null })
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- ChangePracticeDuration.test`
Expected: PASS — all 10 cases (the original 8, the 1 `saveVariant` case from Task 51, and this
task's new radiogroup case). In particular, "loads the current governing practiceTargetSeconds as the
default" (`getByRole('radio', { name: '15 minutes' })).toBeChecked()`), "empty reason blocks submit"
and "server 400 fieldErrors.reason renders inline and keeps the typed values" (`getByLabelText('Reason
for change')).toHaveValue(...)`) all keep passing against the new markup.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/settings/ChangePracticeDuration.tsx apps/web/src/features/settings/ChangePracticeDuration.test.tsx
git commit -m "$(cat <<'EOF'
Give the practice-duration picker a real ARIA radiogroup

Move DurationField onto the generated RadioGroup/RadioGroupItem (a
<fieldset> alone exposes role 'group', not 'radiogroup') with an explicit
aria-labelledby to the legend, and move the reason input onto useField plus
the generated Input/Label for the same id/aria-describedby wiring the rest
of the app now shares.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

### Task 53: Demo controls — shared primitives, and the raw `<button>` fix

`DemoClockPanel.tsx:112-119` renders a raw inline `<button>` for its error-state Retry action instead
of the app's own `Button` — it has no `data-variant` attribute at all, unlike every other
interactive control in the app. `ScenarioLoader.tsx` and `ResetPanel.tsx` each hand-roll their own
`AlertDialog.Overlay`/`Content` classes (one of the three files design.md calls out for this) and
`ScenarioLoader.tsx` also hand-rolls its `Select.Content` positioning classes; both move onto the
generated `alert-dialog`/`select` primitives. Their confirm buttons — "Reset" and "Load" — are the
one legitimate home in this app for the destructive treatment: since `Button` has no `destructive`
variant, both become `variant="secondary"` plus a `border-destructive text-destructive` className,
replacing today's `variant="primary"` (destructive actions never borrow the petrol primary color).
`DemoControls.tsx`'s own boxed `rounded-lg border ... p-4` wrapper is replaced with hairlines between
its three sub-panels, matching Task 50's and Task 51's same move away from "Card as a default
wrapper." The destructive treatment on "Reset"/"Load" is for those two ACTION confirmations only —
each panel's own `isError` message (a failed clock update, load or reset) is a different thing: a
failed save with a Retry beside or implied by it, which the settled colour rule marks as a MESSAGE
the user must act on. All three take the `attention` token instead of the plain `ink-muted` rename
the rest of this file's already-muted text gets, and never destructive/red — that treatment stays on
"Reset"/"Load" alone.

**Files:**
- Modify: `apps/web/src/features/settings/DemoControls.tsx`
- Modify: `apps/web/src/features/settings/DemoClockPanel.tsx`
- Modify: `apps/web/src/features/settings/ScenarioLoader.tsx`
- Modify: `apps/web/src/features/settings/ResetPanel.tsx`
- Modify: `apps/web/src/features/settings/DemoControls.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/ui/Button.js`; `useField` from `@/ui/field.js`; `Input` from
  `@/ui/shadcn/input.js`; `Label` from `@/ui/shadcn/label.js`; `Select`/`SelectContent`/`SelectItem`/
  `SelectTrigger`/`SelectValue` from `@/ui/shadcn/select.js`; `AlertDialog`/`AlertDialogContent`/
  `AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogHeader`/`AlertDialogTitle`/
  `AlertDialogTrigger` from `@/ui/shadcn/alert-dialog.js`.
- Produces: nothing — leaf task.

- [ ] **Step 1: Write the failing test**
Edit `apps/web/src/features/settings/DemoControls.test.tsx` — add `reject` to the existing import and
add a new case (after "the demo label is present on the panel"):

```diff
-import { mockApi, respond } from '../../test/mockClient.js'
+import { mockApi, reject, respond } from '../../test/mockClient.js'
```

```tsx
  it('a failed demo-clock update shows a Retry control built from the app Button primitive', async () => {
    respond('programs.current', NO_PROGRAM)
    reject('demo.clock', { status: 500, code: 'internal_error' })

    const { user } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)
    await user.click(screen.getByRole('button', { name: 'Reset clock' }))

    const retryButton = await screen.findByRole('button', { name: 'Retry' })
    expect(retryButton).toHaveAttribute('data-variant')
    expect(retryButton.tagName).toBe('BUTTON')
  })
```

- [ ] **Step 2: Run it and watch it fail**
Run: `npm run test -w @attention-lab/web -- DemoControls.test`
Expected: FAIL — `expect(retryButton).toHaveAttribute('data-variant')` fails: the current Retry
control is a raw `<button type="button" className="underline">`, which has no `data-variant`
attribute (every other button in this app, built from the shared `Button`, does).

- [ ] **Step 3: Implement**

Replace `apps/web/src/features/settings/DemoClockPanel.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DemoClockBodyValue, MeResponseValue, ProgramResponseValue, SlotResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { skipToDay14OffsetSeconds } from './demoClockMath.js'

/**
 * The demo-clock section of `DemoControls`. `POST /demo/clock` always sends
 * an ABSOLUTE offset from real time — never a delta on top of whatever
 * `me.demoClockOffsetSeconds` already is — so every action below computes
 * the full offset it wants, not an increment. On success the whole query
 * cache is cleared so Today/Progress refetch under the new clock.
 */
export interface DemoClockPanelProps {
  readonly me: MeResponseValue
  readonly program: ProgramResponseValue | null
  readonly slots: readonly SlotResponseValue[]
}

function formatOffsetSeconds(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '−' : '+'
  return `${sign}${Math.abs(offsetSeconds)}s`
}

export function DemoClockPanel({ me, program, slots }: DemoClockPanelProps) {
  const queryClient = useQueryClient()
  const [draftDateTime, setDraftDateTime] = useState('')
  const advanceField = useField({ name: 'demo-clock-advance' })

  const clockMutation = useMutation({
    mutationFn: (body: DemoClockBodyValue) => api.demo.clock(body),
    onSuccess: () => {
      queryClient.clear()
    },
  })

  function handleAdvance() {
    if (draftDateTime === '') {
      return
    }
    const targetMs = new Date(draftDateTime).getTime()
    if (Number.isNaN(targetMs)) {
      return
    }
    clockMutation.mutate({ offsetSeconds: Math.round((targetMs - Date.now()) / 1000) })
  }

  function handleSkipToDay14() {
    if (program === null) {
      return
    }
    clockMutation.mutate({ offsetSeconds: skipToDay14OffsetSeconds(program, slots, new Date()) })
  }

  function handleResetClock() {
    clockMutation.mutate({ offsetSeconds: 0 })
  }

  function handleRetry() {
    clockMutation.mutate(clockMutation.variables ?? { offsetSeconds: 0 })
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Demo clock</h3>
      <p className="text-sm text-ink-muted">Current offset: {formatOffsetSeconds(me.demoClockOffsetSeconds)}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label {...advanceField.labelProps} className="text-sm font-medium text-ink">
            Advance the clock to
          </Label>
          <Input
            {...advanceField.controlProps}
            type="datetime-local"
            value={draftDateTime}
            disabled={clockMutation.isPending}
            onChange={(event) => setDraftDateTime(event.target.value)}
          />
        </div>
        <Button variant="secondary" disabled={draftDateTime === '' || clockMutation.isPending} onClick={handleAdvance}>
          Advance
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={program === null || clockMutation.isPending} onClick={handleSkipToDay14}>
          Skip to Day 14
        </Button>
        <Button variant="secondary" disabled={clockMutation.isPending} onClick={handleResetClock}>
          Reset clock
        </Button>
      </div>

      {clockMutation.isError ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-attention">
          Could not update the demo clock.
          <Button variant="quiet" onClick={handleRetry}>
            Retry
          </Button>
        </p>
      ) : null}
    </div>
  )
}
```

Replace `apps/web/src/features/settings/ScenarioLoader.tsx`:

```tsx
import { useCallback, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DEMO_SCENARIO_NAMES, DEMO_SCENARIOS, type DemoScenarioName } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'
import { Label } from '../../ui/shadcn/label.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/shadcn/select.js'

/**
 * The scenario-load section of `DemoControls`. `POST
 * /demo/scenarios/{name}/load` takes no body — the confirmation dialog IS
 * the consent step. Confirming re-posts the same scenario name so a caller
 * can retry after a failure without re-opening the Select. On success the
 * whole query cache is cleared and the app navigates to `/progress`.
 */
function humanizeScenarioName(name: DemoScenarioName): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function ScenarioLoader() {
  const [selected, setSelected] = useState<DemoScenarioName>(DEMO_SCENARIO_NAMES[0])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const triggerId = useId()

  // Radix's AlertDialog does not auto-focus its content on open in this
  // app, so focus into the dialog is moved explicitly via a callback ref —
  // not a `useEffect` (AlertDialogContent portals its children, so an
  // effect keyed on `open` can run before "Cancel"'s own DOM node exists).
  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])

  const loadMutation = useMutation({
    mutationFn: (name: DemoScenarioName) => api.demo.loadScenario(name),
    onSuccess: () => {
      queryClient.clear()
      setOpen(false)
      navigate('/progress')
    },
  })

  function handleOpenChange(next: boolean) {
    if (loadMutation.isPending) {
      return
    }
    setOpen(next)
  }

  function handleConfirm() {
    loadMutation.mutate(selected)
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Load a demonstration scenario</h3>

      <div className="flex flex-col gap-1">
        <Label htmlFor={triggerId} className="text-sm font-medium text-ink">
          Demonstration scenario
        </Label>
        <Select value={selected} onValueChange={(value) => setSelected(value as DemoScenarioName)}>
          <SelectTrigger id={triggerId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEMO_SCENARIO_NAMES.map((name) => (
              <SelectItem key={name} value={name}>
                {humanizeScenarioName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-ink-muted">{DEMO_SCENARIOS[selected].description}</p>
      </div>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          <Button variant="secondary">Load scenario</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load &ldquo;{humanizeScenarioName(selected)}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>This replaces all demonstration data for this profile</AlertDialogDescription>
          </AlertDialogHeader>

          {loadMutation.isError ? (
            <p role="alert" className="text-sm text-attention">
              Could not load the scenario. Retry.
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              ref={focusOnMount}
              variant="secondary"
              disabled={loadMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={loadMutation.isPending}
              onClick={handleConfirm}
            >
              Load
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

Replace `apps/web/src/features/settings/ResetPanel.tsx`:

```tsx
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { purgeOtherSessions } from '../../lib/outbox/store.js'
import { Button } from '../../ui/Button.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'

const FINALIZE_KEY_PREFIX = 'finalize:'

/** Best-effort removal of every `finalize:{sessionId}` sessionStorage key. */
function clearAllFinalizeKeys(): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key !== null && key.startsWith(FINALIZE_KEY_PREFIX)) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      sessionStorage.removeItem(key)
    }
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

/**
 * The reset section of `DemoControls`. `POST /demo/reset` (204) is followed
 * by: clearing the whole query cache, purging every session's outbox rows,
 * clearing every `finalize:{sessionId}` sessionStorage key, then navigating
 * to `/today`.
 */
export function ResetPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])

  const resetMutation = useMutation({
    mutationFn: () => api.demo.reset(),
    onSuccess: async () => {
      queryClient.clear()
      await purgeOtherSessions(null)
      clearAllFinalizeKeys()
      setOpen(false)
      navigate('/today')
    },
  })

  function handleOpenChange(next: boolean) {
    if (resetMutation.isPending) {
      return
    }
    setOpen(next)
  }

  function handleConfirm() {
    resetMutation.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Reset demo data</h3>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          <Button variant="secondary">Reset demo data</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all demonstration data?</AlertDialogTitle>
            <AlertDialogDescription>This replaces all demonstration data for this profile</AlertDialogDescription>
          </AlertDialogHeader>

          {resetMutation.isError ? (
            <p role="alert" className="text-sm text-attention">
              Could not reset. Retry.
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              ref={focusOnMount}
              variant="secondary"
              disabled={resetMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={resetMutation.isPending}
              onClick={handleConfirm}
            >
              Reset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

Replace `apps/web/src/features/settings/DemoControls.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import type { MeResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { DemoClockPanel } from './DemoClockPanel.js'
import { ResetPanel } from './ResetPanel.js'
import { ScenarioLoader } from './ScenarioLoader.js'

/**
 * Demo-only Settings controls: the demo clock, the scenario loader and the
 * reset action. Renders nothing outside `local-demo` mode, mirroring
 * `DemoBanner.tsx`'s own self-guard rather than trusting only the caller's
 * gate. Structure comes from hairlines between the three sub-panels, not a
 * boxed wrapper.
 */
export interface DemoControlsProps {
  readonly me: MeResponseValue
}

export function DemoControls({ me }: DemoControlsProps) {
  const isDemoMode = me.identityMode === 'local-demo'

  const programQuery = useQuery({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
    enabled: isDemoMode,
  })

  if (!isDemoMode) {
    return null
  }

  const program = programQuery.data?.program ?? null
  const slots = programQuery.data?.slots ?? []

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-ink">Demonstration controls</h2>

      <DemoClockPanel me={me} program={program} slots={slots} />
      <div className="flex flex-col gap-3 border-t border-rule pt-6">
        <ScenarioLoader />
      </div>
      <div className="flex flex-col gap-3 border-t border-rule pt-6">
        <ResetPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**
Run: `npm run test -w @attention-lab/web -- DemoControls.test`
Expected: PASS — all 9 cases (the original 8, plus the new Retry-button case). In particular "Load
without confirmation posts nothing" (`findByRole('alertdialog')`), "confirmed Load posts to
/demo/scenarios/{name}/load..." (`getByRole('combobox', { name: 'Demonstration scenario' })`,
`getByRole('option', { name: optionName })`), and "confirmed Reset posts /demo/reset..." all keep
passing against the generated `Select`/`AlertDialog` primitives.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/settings/DemoControls.tsx apps/web/src/features/settings/DemoClockPanel.tsx apps/web/src/features/settings/ScenarioLoader.tsx apps/web/src/features/settings/ResetPanel.tsx apps/web/src/features/settings/DemoControls.test.tsx
git commit -m "$(cat <<'EOF'
Move demo controls onto shared primitives and fix the raw retry button

DemoClockPanel's error-state Retry now uses the app's own Button (it had no
data-variant at all before). ScenarioLoader and ResetPanel move their
hand-rolled Select/AlertDialog markup onto the generated primitives, and
their destructive confirm actions (Load, Reset) move off variant="primary"
onto variant="secondary" plus a destructive className, per design.md's
"no fourth Button variant" decision.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017siTyBeMYEJtCynrj1h73u
EOF
)"
```

---

# Wave 2 — Verification (sequential, single owner)

Wave 2 begins only when all twelve Wave 1 units are committed. Nothing here is optional, and no
step here may be satisfied by editing a test. If a suite fails, the rework broke a contract — fix
the rework.

---

### Task V1: No token references survive

**Files:** none created; fixes land in whichever file the grep finds.

**Interfaces:**
- Consumes: the completed Wave 1 units.
- Produces: nothing — leaf task.

- [ ] **Step 1: Search for every superseded token name**

```bash
grep -rn "color-bg\|color-surface\|color-text\|color-primary\|color-primary-text\|color-border" apps/web/src --include=*.tsx --include=*.ts
```

Expected: no output. Wave 0 Task 8 Step 3 recorded the starting count; this must now be zero.

- [ ] **Step 2: Search for hardcoded hex outside the token definitions and the chart palette**

```bash
grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src --include=*.tsx | grep -v "DailyTrend\|PracticeTrend"
```

Expected: no output. Chart series colours are the one legitimate place for literal hex, because they
are a validated categorical palette rather than semantic tokens. Anything else is a token that
should have been used.

- [ ] **Step 3: Fix every hit, then re-run both greps**

Expected: both empty.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "Convert the last superseded token references"
```

---

### Task V2: The full suite, unmodified

**Files:** none. This task changes nothing by design.

**Interfaces:**
- Consumes: all twelve completed Wave 1 units.
- Produces: nothing — verification only.

- [ ] **Step 1: Confirm no test file was modified outside the ones Wave 1 legitimately touched**

```bash
git diff --stat b7409ea..HEAD -- e2e/
```

Expected: **no output at all.** The Playwright acceptance, invariant and a11y suites assert the
contract this rework promised not to break. A diff here means either the rework broke something and
a test was edited to hide it, or a genuine contract change happened that was never agreed. Either
way, stop and report rather than proceeding.

- [ ] **Step 2: Typecheck every workspace**

Run: `npm run typecheck`
Expected: PASS, including `typecheck:e2e`.

- [ ] **Step 3: Full unit suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS. Record the bundle size and compare against the figure noted in Wave 0 Task 3
Step 3 — the delta beyond the fonts is the cost of the primitive layer, which spec §12 flags as
unmeasured.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "Fix typecheck and unit failures surfaced by the full suite"
```

---

### Task V3: End-to-end and accessibility suites

**Files:** none.

**Interfaces:**
- Consumes: a green typecheck and unit suite from Task V2.
- Produces: nothing — verification only.

- [ ] **Step 1: Install the browser if this machine has not**

Run: `npm run e2e:install`

- [ ] **Step 2: Run the full Playwright suite**

Run: `npm run e2e`
Expected: PASS. This covers `e2e/acceptance/`, `e2e/invariants/`, `e2e/a11y/` and the feature specs.

- [ ] **Step 3: Confirm the four a11y suites specifically**

Run: `npx playwright test --config e2e/playwright.config.ts e2e/a11y/`
Expected: PASS on `axe-shell`, `axe-session`, `keyboard-review`, `reduced-motion` and
`timer-live-region`.

`keyboard-review` is the one most likely to fail, because it is the suite that originally caught
Radix's `AlertDialog.Content` failing to auto-focus its first tabbable child. If it fails, the
`focusOnMount` callback ref was dropped or converted to a `useEffect` during the dialog
consolidation — restore the callback ref.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "Fix end-to-end and accessibility failures"
```

---

### Task V4: Re-verify the computed claims

The spec states contrast ratios and a validated chart palette. Both were computed before any code
existed, so both must be checked against what actually shipped.

**Files:** possibly `apps/web/src/index.css`, `docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md`

**Interfaces:**
- Consumes: the shipped `index.css` from Wave 0 Task 2 and the chart colours from the Progress unit.
- Produces: corrected contrast figures in both the CSS comments and the rework spec, if any drifted.

- [ ] **Step 1: Recompute every contrast pair against the shipped CSS**

```bash
node -e "
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4) }
const L = h => { const n=parseInt(h.slice(1),16); return 0.2126*lin(n>>16&255)+0.7152*lin(n>>8&255)+0.0722*lin(n&255) }
const ratio = (a,b) => { const x=L(a), y=L(b); const [hi,lo]=x>y?[x,y]:[y,x]; return ((hi+0.05)/(lo+0.05)).toFixed(2) }
const paper='#F3F5F5'
console.log('ink on paper        ', ratio('#16232B', paper), '(spec says ~14.7)')
console.log('ink-muted on paper  ', ratio('#455761', paper), '(spec says ~6.6)')
console.log('white on signal     ', ratio('#FFFFFF', '#0B5F63'), '(spec says ~7.4)')
console.log('attention on paper  ', ratio('#8A5A00', paper), '(spec says ~5.4)')
console.log('white on attention  ', ratio('#FFFFFF', '#8A5A00'), '(spec says ~5.9)')
console.log('white on destructive', ratio('#FFFFFF', '#8C2F1B'))
"
```

Expected: every text pair at or above 4.5, every figure within 0.2 of the spec's. If a hex changed
during implementation, update both the CSS comment and the spec's §3 table so neither carries a
stale number.

- [ ] **Step 2: Re-validate the chart palette against the shipped surface**

```bash
node "C:/Users/Doug/AppData/Local/Temp/claude/bundled-skills/2.1.265/65537a0b92686944af51683823b6ff3a/dataviz/scripts/validate_palette.js" \
  "#2a78d6,#C24E1F,#157F5C,#4a3aa7,#C85480" --mode light --surface "#F3F5F5"
```

Expected: `ALL CHECKS PASS`, with no contrast warning. If the skill's bundled path has moved, the
same six checks are: lightness band, chroma floor, adjacent-pair CVD separation (target ΔE ≥ 8),
normal-vision floor (≥ 15), and contrast ≥ 3:1 against the surface.

- [ ] **Step 3: Commit any corrections to the CSS or the spec**

```bash
git add apps/web/src/index.css docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md
git commit -m "Correct contrast figures to match the shipped palette"
```

---

### Task V5: The visual pass

The suites assert semantics, not appearance. A screen can be visually broken with everything green.
This is the only step that catches that, and it is manual and therefore fallible — spec §12 says so
explicitly.

**Files:** none.

**Interfaces:**
- Consumes: a fully built app with every Wave 1 unit merged.
- Produces: a dated note in the rework spec §12 recording what this pass caught, so its value is known next time.

- [ ] **Step 1: Start the app against demo data**

```bash
npm run db:up && npm run db:push
npm run dev:api &
npm run dev:web
```

- [ ] **Step 2: Load a scenario that populates every screen**

Go to `/settings`, and under Demonstration controls use "Load scenario" to load **Working Day**.
Then use "Skip to Day 14" so Progress has a real comparison to render.

- [ ] **Step 3: Walk every screen and check these five things on each**

Screens: `/today`, `/setup`, `/setup/readiness`, a benchmark `/benchmark/{slotId}` in both Ready and
Running, `/benchmark/{id}/recall`, `/benchmark/{id}/scoring`, a `/focus/{id}` session, a
`/review/{id}`, `/checkin/{date}`, `/progress`, `/research`, `/settings`, and `/nope` for the 404.

On each, confirm:
1. No horizontal scrollbar on the page body. Wide tables and charts scroll inside their own
   container, never the page.
2. Exactly one petrol-filled button is visible.
3. Every absent value shows the ruled-slot treatment, and no absent value renders as `0` or as an
   empty cell.
4. Text does not collide, overflow its container, or wrap mid-word.
5. Nothing animates except a value settling from pending to recorded.

- [ ] **Step 4: Check the two responsive breakpoints**

Resize to 375px wide and to 1440px. At 375px the nav must be a fixed bottom bar with
`data-placement="bottom"`, and `<main>` must clear it. At 1440px the rail returns.

- [ ] **Step 5: Check reduced motion and keyboard**

Enable the OS "reduce motion" setting and reload `/focus/{id}` — the timer must not transition.
Then, without touching the mouse, Tab from the top of `/today`: the first focusable element must be
"Skip to content", every focused element must show the single black outline, and no element may show
two focus indicators.

- [ ] **Step 6: Record what you found**

Append a short dated note to the spec's §12 recording what the visual pass caught, so the next
person knows what this step is worth. If it caught nothing, say that.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Fix layout defects found in the visual pass"
```

---

### Task V6: Full verification and documentation

**Files:** `README.md`, `LIMITATIONS.md`, `docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md`

**Interfaces:**
- Consumes: green results from Tasks V1-V5.
- Produces: the updated spec status line, and the README integrity note. This is the last task.

- [ ] **Step 1: The whole pipeline from a clean database**

Run: `npm run verify:all`
Expected: a PASS row for every stage — fresh container, `db:up`, `db:push`, typecheck, test, build,
e2e. It stops at the first failure, so a partial table means a real failure.

- [ ] **Step 2: Confirm the CLAUDE.md guard still passes**

Run: `node scripts/check-claude-md.mjs`
Expected: PASS. That script keeps one section of `CLAUDE.md` byte-identical to the original bundle.
This rework does not touch it; if the script fails, something edited a protected section.

- [ ] **Step 3: Confirm the limitations guard still passes**

Run: `node scripts/check-limitations.mjs && node scripts/check-pins.mjs`
Expected: PASS and `PINS OK`. The six new dependencies from Wave 0 Tasks 1 and 3 must all appear.

- [ ] **Step 4: Update the spec's status line**

Change the header from `**Status:** design, approved section by section on 2026-09-09. Not
implemented.` to record the implementing commit range and the date.

- [ ] **Step 5: Note the integrity consequence in README**

`README.md` has an `## Integrity` section explaining which `MANIFEST.sha256` entries fail and why.
This change does not touch any manifest-listed file, so no checksum moves — state that explicitly so
the next reader does not have to re-derive it.

- [ ] **Step 6: Commit**

```bash
git add README.md LIMITATIONS.md docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md
git commit -m "Record the completed UI rework in the project documents"
```

---

## Definition of done

- [ ] `npm run verify:all` passes end to end from a fresh database container.
- [ ] `git diff b7409ea..HEAD -- e2e/` is empty.
- [ ] Both greps in Task V1 return nothing.
- [ ] The chart palette re-validates with no contrast warning.
- [ ] The visual pass has been walked on every screen at both breakpoints, and what it found is
      written down.
- [ ] `LIMITATIONS.md` lists all six new pins and `check-pins.mjs` prints `PINS OK`.
