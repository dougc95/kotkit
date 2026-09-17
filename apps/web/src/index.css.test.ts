import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

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
