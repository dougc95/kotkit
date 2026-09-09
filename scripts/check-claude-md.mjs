// Checks CLAUDE.md against two invariants:
//   (a) every `npm run <name>` command it names actually exists in the root
//       package.json scripts;
//   (b) the "Authority order", "Invariants that govern all work here" and
//       "Style of the documents" sections, plus the trailing Codex/import
//       footer, are byte-identical to their content in the root commit
//       07ec808 (the original design handoff bundle) — the register those
//       sections were written in must survive edits to the rest of the file.
// Node only (jq and python are not on PATH in this environment).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGINAL_COMMIT = '07ec808'

const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8')
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

const problems = []

// --- (a) every "npm run <name>" mentioned must exist in package.json scripts ---

const commandNames = new Set()
for (const match of claudeMd.matchAll(/npm run ([A-Za-z][A-Za-z0-9:_-]*)/g)) {
  commandNames.add(match[1])
}

if (commandNames.size === 0) {
  problems.push('No "npm run <name>" commands were found in CLAUDE.md at all — expected the Commands section to name the root scripts.')
}

for (const name of [...commandNames].sort()) {
  if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
    problems.push(`CLAUDE.md names "npm run ${name}" but package.json has no such script.`)
  }
}

// --- (b) protected sections must be byte-identical to the root commit ---

let original
try {
  original = execFileSync('git', ['show', `${ORIGINAL_COMMIT}:CLAUDE.md`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
} catch (err) {
  problems.push(`Could not read CLAUDE.md from commit ${ORIGINAL_COMMIT}: ${err.message}`)
  original = ''
}

// A section runs from its heading up to (but not including) whichever comes
// first: the next "## " heading, or the "---" footer rule, or end of file.
function extractSection(content, heading) {
  const start = content.indexOf(heading)
  if (start === -1) return null
  const searchFrom = start + heading.length
  const candidates = [content.indexOf('\n## ', searchFrom), content.indexOf('\n---\n', searchFrom)].filter(
    (i) => i !== -1,
  )
  const end = candidates.length > 0 ? Math.min(...candidates) : content.length
  return content.slice(start, end)
}

// The footer runs from the "---" rule to end of file.
function extractFooter(content) {
  const start = content.indexOf('\n---\n')
  if (start === -1) return null
  return content.slice(start)
}

const protectedHeadings = [
  '## Authority order — read this before resolving any conflict',
  '## Invariants that govern all work here',
  '## Style of the documents',
]

for (const heading of protectedHeadings) {
  const originalSection = extractSection(original, heading)
  const currentSection = extractSection(claudeMd, heading)
  if (originalSection === null) {
    problems.push(`Root commit ${ORIGINAL_COMMIT}'s CLAUDE.md has no section "${heading}" to compare against.`)
    continue
  }
  if (currentSection === null) {
    problems.push(`CLAUDE.md is missing the protected section "${heading}".`)
    continue
  }
  if (currentSection !== originalSection) {
    problems.push(`CLAUDE.md's "${heading}" section has changed since commit ${ORIGINAL_COMMIT}; it must stay byte-identical.`)
  }
}

const originalFooter = extractFooter(original)
const currentFooter = extractFooter(claudeMd)
if (originalFooter === null) {
  problems.push(`Root commit ${ORIGINAL_COMMIT}'s CLAUDE.md has no "---" footer to compare against.`)
} else if (currentFooter === null) {
  problems.push('CLAUDE.md is missing the trailing "---" Codex/import footer.')
} else if (currentFooter !== originalFooter) {
  problems.push(`CLAUDE.md's trailing Codex/import footer has changed since commit ${ORIGINAL_COMMIT}; it must stay byte-identical.`)
}

if (problems.length > 0) {
  console.error('CLAUDE.md check failed:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log('CLAUDE_MD_OK')
