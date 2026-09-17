import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const srcDir = fileURLToPath(new URL('./', import.meta.url))

// A shadcn "alias" declaration in :root looks like `--<name>: var(--color-<token>);`
// (e.g. `--background: var(--color-paper);`, `--ring: var(--color-focus-ring);`).
// Deriving the name list this way, instead of hard-coding it, keeps the drift
// guard below honest if a future change adds or removes an alias.
const ALIAS_DECLARATION = /^\s*--([\w-]+):\s*var\(--color-[\w-]+\);\s*$/gm

function deriveAliasNames(source: string): string[] {
  // Group 1 is mandatory in ALIAS_DECLARATION, so it is always captured.
  return [...source.matchAll(ALIAS_DECLARATION)].map((match) => match[1]!)
}

const COLOR_PROPERTY_KEYWORDS = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'caret',
  'decoration',
  'from',
  'via',
  'to',
]

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
    for (const dead of ['--color-bg:', '--color-surface:', '--color-text:']) {
      expect(css).not.toContain(dead)
    }
  })

  it('--color-primary and --color-border exist only as shadcn aliases, never as a second hex value', () => {
    for (const [colorName, aliasVar] of [
      ['--color-primary', '--primary'],
      ['--color-border', '--border'],
    ] as const) {
      const declarations = [...css.matchAll(new RegExp(`${colorName}:\\s*([^;]+);`, 'g'))].map(
        (match) => match[1]!.trim()
      )
      expect(declarations).toEqual([`var(${aliasVar})`])
    }
  })

  it('the @theme inline block declares every shadcn alias as a --color-* theme key', () => {
    const inlineBlockMatch = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/)
    expect(inlineBlockMatch).not.toBeNull()
    const inlineBlock = inlineBlockMatch![1]

    // card and destructive are already literal @theme keys; every other
    // alias must be mapped here or Tailwind never generates its utility.
    const expectedNames = deriveAliasNames(css).filter(
      (name) => name !== 'card' && name !== 'destructive'
    )
    expect(expectedNames.length).toBeGreaterThan(0)
    for (const name of expectedNames) {
      expect(inlineBlock).toContain(`--color-${name}: var(--${name});`)
    }
  })

  it('every shadcn alias colour utility the generated primitives actually use has a theme key (drift guard)', () => {
    const aliasNames = deriveAliasNames(css)
    // Try longer names first (e.g. "accent-foreground" before "accent") so a
    // token like `text-accent-foreground` is not truncated to `accent`.
    const namesPattern = [...aliasNames].sort((a, b) => b.length - a.length).join('|')
    const tokenRegex = new RegExp(
      `(?:${COLOR_PROPERTY_KEYWORDS.join('|')})-(${namesPattern})(?:/\\d+)?(?![\\w-])`,
      'g'
    )

    const shadcnDir = new URL('./ui/shadcn/', import.meta.url)
    const files = readdirSync(shadcnDir).filter((name) => name.endsWith('.tsx'))
    expect(files.length).toBeGreaterThan(0)

    const usedNames = new Set<string>()
    for (const file of files) {
      const source = readFileSync(new URL(file, shadcnDir), 'utf8')
      for (const match of source.matchAll(tokenRegex)) {
        // The name group is mandatory in tokenRegex, so it is always captured.
        usedNames.add(match[1]!)
      }
    }

    const missing = [...usedNames].filter((name) => !css.includes(`--color-${name}:`)).sort()
    expect(missing).toEqual([])
  })

  it('keeps --accent distinct from --popover so the Select active-option highlight is not white-on-white', () => {
    const accentMatch = css.match(/--accent:\s*([^;]+);/)
    const popoverMatch = css.match(/--popover:\s*([^;]+);/)
    expect(accentMatch).not.toBeNull()
    expect(popoverMatch).not.toBeNull()
    expect(accentMatch![1]!.trim()).not.toBe(popoverMatch![1]!.trim())
  })
})

// Recursively lists every file under src (this file's own directory),
// relative to it and with forward slashes regardless of OS, so callers can
// filter with plain string matching.
function listSourceFiles(): string[] {
  return (readdirSync(srcDir, { recursive: true }) as string[])
    .map((relPath) => relPath.split('\\').join('/'))
    .filter((relPath) => !statSync(join(srcDir, relPath)).isDirectory())
}

describe('index.css dark-variant scoping (this app is light-only)', () => {
  it('declares the class-scoped dark variant', () => {
    // Tolerant of whitespace only: this is the exact shadcn Tailwind-4 idiom,
    // not a pattern with legitimate variants.
    expect(css).toMatch(/@custom-variant\s+dark\s*\(\s*&:is\(\s*\.dark\s+\*\s*\)\s*\)/)
  })

  it('declares no dark palette, pinning the light-only premise', () => {
    // If a dark palette is ever added, this guard must be revisited alongside it.
    // Matches an actual `@media (prefers-color-scheme...)` rule, not the
    // explanatory comment above `@custom-variant` that names the term.
    expect(css).not.toMatch(/@media[^{]*prefers-color-scheme/)
    expect(css).not.toMatch(/\.dark\s*\{/)
  })

  it('nothing outside the generated shadcn primitives sets the dark class', () => {
    // Built from concatenated parts, not as a literal, so this guard's own
    // source is never itself a Tailwind-scannable "dark" class candidate.
    const classNameDark = 'class' + 'Name="' + 'dark' + '"'
    const classListAddDark = 'classList.add(' + "'" + 'dark' + "'" + ')'

    const offenders = listSourceFiles().filter((relPath) => {
      if (relPath.startsWith('ui/shadcn/')) return false
      if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return false
      if (relPath === 'index.css') return false
      const source = readFileSync(join(srcDir, relPath), 'utf8')
      return source.includes(classNameDark) || source.includes(classListAddDark)
    })

    expect(offenders).toEqual([])
  })

  it('index.html sets no class attribute value containing the dark token (the likeliest place for class="dark" on <html>)', () => {
    // Resolved the same way srcDir above is (fileURLToPath + node:path join), never a literal
    // two-argument `new URL('<literal>', import.meta.url)`.
    const indexHtml = readFileSync(join(srcDir, '..', 'index.html'), 'utf8')

    // Built from concatenated parts, matching the style of classNameDark/classListAddDark above.
    const classAttr = 'class' + '="'
    const classValues = [...indexHtml.matchAll(new RegExp(classAttr + '([^"]*)"', 'g'))].map(
      (match) => match[1]!
    )
    const hasDarkToken = classValues.some((value) => value.split(/\s+/).includes('dark'))

    expect(hasDarkToken).toBe(false)
  })
})

describe('index.css Tailwind source scanning', () => {
  it('excludes test files, the test-support directory and type-test files from the source scan, so a guard test naming a forbidden class does not ship it as dead CSS', () => {
    expect(css).toMatch(/@source not ["']\.\/\*\*\/\*\.test\.ts["'];/)
    expect(css).toMatch(/@source not ["']\.\/\*\*\/\*\.test\.tsx["'];/)
    expect(css).toMatch(/@source not ["']\.\/test\/\*\*["'];/)
    expect(css).toMatch(/@source not ["']\.\/\*\*\/\*\.test-d\.ts["'];/)
  })
})
