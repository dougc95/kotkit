// Checks that LIMITATIONS.md has all ten required "## " headings, that the
// "Task-group coverage" table carries exactly ten data rows (one per task
// group), and that every literal string the document is required to record
// (D40's five items, D22's three AJV options, and D19's write-limiter note)
// is actually present. Node only (jq and python are not on PATH in this
// environment).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const limitationsPath = resolve(repoRoot, 'LIMITATIONS.md')
const limitations = readFileSync(limitationsPath, 'utf8')

const failures = []

// --- Ten "## " headings -----------------------------------------------
const REQUIRED_HEADINGS = [
  '## Identity gate (D2)',
  '## Version pins (D3)',
  '## Specification defects settled (D7)',
  '## What works',
  '## What was tested',
  '## Recovery: simulated vs field-tested',
  '## Thresholds chosen',
  '## Deferred',
  '## Reversible decision: local-pilot',
  '## Task-group coverage',
]

const headingLines = limitations.split('\n').filter((line) => line.startsWith('## '))

if (headingLines.length !== 10) {
  failures.push(
    `expected exactly 10 "## " headings, found ${headingLines.length}: ${JSON.stringify(headingLines)}`
  )
}

for (const heading of REQUIRED_HEADINGS) {
  if (!limitations.includes(`\n${heading}\n`) && !limitations.startsWith(`${heading}\n`)) {
    failures.push(`missing required heading: ${JSON.stringify(heading)}`)
  }
}

// --- Task-group coverage table: exactly 10 data rows --------------------
const coverageStart = limitations.indexOf('## Task-group coverage')
if (coverageStart === -1) {
  failures.push('no "## Task-group coverage" heading to read the table from')
} else {
  const coverageSection = limitations.slice(coverageStart)
  const dataRows = coverageSection
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| group') && !/^\|\s*---/.test(line))

  if (dataRows.length !== 10) {
    failures.push(
      `"Task-group coverage" table must have exactly 10 data rows, found ${dataRows.length}`
    )
  }
}

// --- Required literal strings --------------------------------------------
// D40's five items, distinguished by a phrase unique to each; D22's three
// AJV option literals; D19's write-limiter note; the recall/clock-gap
// threshold numbers from design.md.
const REQUIRED_LITERALS = [
  'receipts expire on the demo clock',
  'graceful shutdown',
  'POSIX',
  'paired simulated clocks',
  'not field-tested',
  '24×24',
  'abstract-reviewed',
  'coerceTypes: false',
  'removeAdditional: false',
  'useDefaults: false',
  '429',
  'write_limit',
  '600',
  '210',
]

// Compare against whitespace-collapsed, case-folded text so a phrase that
// happens to wrap across two Markdown source lines (this document is
// hard-wrapped for readability) or differs only in letter case still counts
// as present.
const normalized = limitations.replace(/\s+/g, ' ').toLowerCase()

for (const literal of REQUIRED_LITERALS) {
  if (!normalized.includes(literal.replace(/\s+/g, ' ').toLowerCase())) {
    failures.push(`missing required literal string: ${JSON.stringify(literal)}`)
  }
}

if (failures.length > 0) {
  console.error('LIMITATIONS.md check failed:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log('LIMITATIONS_OK')
