import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Copy the app must never display (app-shell spec, "Copy never punishes or
 * gamifies"): streaks/streak loss, confetti, celebratory framing, warnings
 * about damaged attention, instructions to restart or start over, and any
 * percentage framed as an attention score.
 */
export const FORBIDDEN_TERMS = [
  'streak',
  'confetti',
  'attention score',
  'attention +',
  'damaged attention',
  'restart the program',
  'start over',
] as const

export interface CopyGuardMatch {
  file: string
  term: string
  line: number
}

/**
 * Strips `//` line comments and `/* ... *\/` block comments from source
 * text. Naive (does not understand string/template literals, so a term
 * that happens to appear inside a `//` inside a string would also be
 * stripped) — sufficient for a guard that only needs to ignore genuine
 * comments, never to parse TypeScript correctly.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** The forbidden terms actually present in `source`, comments excluded. */
export function scanText(source: string): string[] {
  const lowered = stripComments(source).toLowerCase()
  return FORBIDDEN_TERMS.filter((term) => lowered.includes(term))
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * `*.test.*` / `*.test-d.*` files and everything under `src/test/` (this
 * module and its own test included — an inline fixture in the test file
 * legitimately contains the forbidden words) are excluded from the tree
 * scan.
 */
export function isExcludedFromCopyGuard(relativePath: string): boolean {
  const normalized = toPosixPath(relativePath)
  if (normalized === 'test' || normalized.startsWith('test/')) {
    return true
  }
  return /\.test\.[^/]+$/.test(normalized) || /\.test-d\.[^/]+$/.test(normalized)
}

function listSourceFiles(rootDir: string): string[] {
  const files: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry)) {
        continue
      }
      if (isExcludedFromCopyGuard(relative(rootDir, fullPath))) {
        continue
      }
      files.push(fullPath)
    }
  }

  walk(rootDir)
  return files
}

/**
 * Scans every `.ts`/`.tsx` file under `rootDir` (normally `apps/web/src`),
 * excluded paths aside, for the forbidden terms and returns every match
 * found. An empty array means the tree is clean.
 */
export function scanTree(rootDir: string): CopyGuardMatch[] {
  const matches: CopyGuardMatch[] = []

  for (const file of listSourceFiles(rootDir)) {
    const stripped = stripComments(readFileSync(file, 'utf8'))
    const lowered = stripped.toLowerCase()

    for (const term of FORBIDDEN_TERMS) {
      const index = lowered.indexOf(term)
      if (index === -1) {
        continue
      }
      const line = stripped.slice(0, index).split('\n').length
      matches.push({ file: toPosixPath(relative(rootDir, file)), term, line })
    }
  }

  return matches
}
