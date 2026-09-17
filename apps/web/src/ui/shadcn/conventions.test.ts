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
})
