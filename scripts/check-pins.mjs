// Compares the "## Version pins (D3)" table in LIMITATIONS.md against the
// resolved versions in package-lock.json. Node only (jq and python are not on
// PATH in this environment).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const limitations = readFileSync(resolve(repoRoot, 'LIMITATIONS.md'), 'utf8')
const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'))

const tableStart = limitations.indexOf('## Version pins (D3)')
if (tableStart === -1) throw new Error('LIMITATIONS.md has no "## Version pins (D3)" heading')
const nextHeading = limitations.indexOf('\n## ', tableStart + 1)
const section = limitations.slice(tableStart, nextHeading === -1 ? undefined : nextHeading)

const rows = section
  .split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('| package') && !/^\|---/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()).filter((cell, i, arr) => i > 0 && i < arr.length - 1))

if (rows.length === 0) throw new Error('No pin rows found under "## Version pins (D3)"')

// Table cells carry Markdown emphasis for readability (the one stepped-back
// pin is bolded, package names are sometimes code-spanned). Compare the
// version values themselves, not their markup.
const plain = (cell) => cell.replace(/[`*]/g, '').trim()

const mismatches = []
for (const [pkgCell, , pinnedCell] of rows) {
  const pkg = plain(pkgCell)
  const pinned = plain(pinnedCell)
  const key = `node_modules/${pkg}`
  const resolved = lock.packages[key]?.version
  if (!resolved) {
    mismatches.push(`${pkg}: not found in package-lock.json at ${key}`)
    continue
  }
  if (resolved !== pinned) {
    mismatches.push(`${pkg}: LIMITATIONS.md says ${pinned}, package-lock.json has ${resolved}`)
  }
}

if (mismatches.length > 0) {
  console.error('Pin mismatches found:')
  for (const m of mismatches) console.error(`  - ${m}`)
  process.exit(1)
}

console.log('PINS OK')
