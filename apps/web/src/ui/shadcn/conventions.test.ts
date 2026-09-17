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

  it.each(files)('%s declares no outline-suppressing utility', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    // Matches bare or variant-prefixed outline-none/outline-hidden (e.g. `outline-none`,
    // `focus:outline-hidden`). Does not match `variant: "outline"`, an `outline:` cva key,
    // or `variant="outline"` — none of those contain the literal `outline-none`/`outline-hidden`
    // substring this checks for.
    expect(source).not.toMatch(/outline-(?:none|hidden)\b/)
  })

  it.each(files)('%s declares no focus-variant utility of its own', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    // Matches any Tailwind variant whose name contains `focus` immediately (optionally through
    // hyphenated modifiers like `-visible`/`-within`) followed by `:` — e.g. `focus:`,
    // `focus-visible:`, `focus-within:`, `group-focus:`, `peer-focus-visible:`. Case-sensitive,
    // so it does not match camelCase props such as `onOpenAutoFocus` or `autoFocus`, which have
    // no `:` after `focus` and use a capital F.
    expect(source).not.toMatch(/\bfocus(?:-[a-z]+)*:/)
  })

  it.each(files)('%s never gives an invalid field the destructive (red) treatment', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    // Spec U15/U15a: an error is never red. `useField` sets `aria-invalid="true"`
    // on any control with a validation error, so an `aria-invalid:` utility that
    // references `destructive` — bare (`aria-invalid:border-destructive`) or
    // variant-prefixed (`dark:aria-invalid:ring-destructive/40`) — would turn
    // every invalid field red. A required field left blank is not a destructive
    // action; it takes the `attention` treatment instead. This does not match the
    // legitimate `destructive` variant classes (`variant: "destructive"`,
    // `bg-destructive`, `text-destructive`, `hover:bg-destructive/90`), because
    // none of those contain the literal `aria-invalid:` prefix this checks for.
    expect(source).not.toMatch(/aria-invalid:[\w/-]*destructive/)
  })

  it('input.tsx floors the input height at 44px (min-h-11), not the generated 36px (h-9)', () => {
    // Guards D40 (24px floor) and the app's 44px control convention against a shadcn
    // regeneration reverting to the default h-9 (36px) input height.
    const source = readFileSync(join(dir, 'input.tsx'), 'utf8')
    expect(source).toContain('min-h-11')
    // Matches a standalone `h-9` token wherever it sits in the string — including as the
    // first or last token, where it is bounded by a quote rather than whitespace, which a
    // `(^|\s)`/`(?=\s|$)` check would miss — via token-boundary lookaround instead. Still
    // does not flag `min-h-9`, `file:h-9` or `data-[size=default]:h-9`.
    expect(source).not.toMatch(/(?<![\w:./-])h-9(?![\w./-])/)
  })

  it('select.tsx floors the trigger at 44px and keeps SelectItem a 44px touch target', () => {
    // Guards D40 and the app's 44px convention against a regeneration reverting the
    // default trigger height to h-9 (36px) or leaving SelectItem at its ~32px generated height.
    const source = readFileSync(join(dir, 'select.tsx'), 'utf8')
    expect(source).toContain('data-[size=default]:min-h-11')
    // Built from two parts so this literal — naming a class that must NOT exist — never
    // appears whole in this file: Tailwind 4 scans test files too, and the intact string
    // would be picked up as a candidate class and emitted as a dead rule in the built CSS.
    const generatedSelectTriggerHeight = 'data-[size=default]:' + 'h-9'
    expect(source).not.toContain(generatedSelectTriggerHeight)
    const selectItemBlock = source.slice(
      source.indexOf('function SelectItem('),
      source.indexOf('function SelectSeparator(')
    )
    expect(selectItemBlock).toContain('min-h-11')
  })

  it.each(['checkbox.tsx', 'radio-group.tsx'])(
    '%s extends its 16px control to a 24px hit area (after:-inset-1) per D40',
    (file) => {
      // Guards D40's 24px hit-area floor for the 16px checkbox/radio visual box against a
      // regeneration dropping the pseudo-element hit-area extension.
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source).toMatch(/\bafter:absolute\b/)
      expect(source).toMatch(/\bafter:-inset-1\b/)
    }
  )
})
