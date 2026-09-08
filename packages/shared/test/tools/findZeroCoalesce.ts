/**
 * Static-analysis tool backing `noCoalesce.test.ts` (task 2.9.1).
 *
 * "Unknown does not equal zero" (HANDOFF.md) is the single most important
 * invariant in this codebase (see `../../src/domain/types.ts`), and the
 * easiest way to violate it is silently: `count ?? 0`, `COALESCE(x, 0)` and
 * `integer('col').default(0)` all look like harmless defaulting but each one
 * turns "not reported" into "reported as zero". This module finds every
 * instance of that pattern across the real source tree so a regression fails
 * a test instead of corrupting a measurement.
 *
 * Three independent passes, run over `packages/shared/src`, `apps/api/src`
 * (and, because it nests under it, `apps/api/src/db/migrations`):
 *
 *   (a) TypeScript compiler API — a `BinaryExpression` using `??` or `||`
 *       whose right side is the literal `0` and whose left side's checked
 *       type is a nullable number (a `ReportedCount`-shaped value). This is
 *       the only pass that needs real type information, because `x || 0` is
 *       fine when `x` can never be null/undefined.
 *   (b) A line-based regex over `.ts`/`.sql` text for
 *       `COALESCE(<anything>, 0)` — covers drizzle `sql` templates and raw
 *       migration SQL, neither of which the TS checker sees as TypeScript.
 *   (c) A line-based regex over the same files for a nullable numeric
 *       column's drizzle definition given `.default(0)` — the D7.1 nullable
 *       columns plus D26's `clock_gap_seconds`.
 *
 * Fixtures for each pass live under `test/fixtures/coalesce/` and are
 * excluded from the package's own typecheck (`packages/shared/tsconfig.json`
 * `exclude`), because a couple of them are deliberately-bad code (and one
 * imports `drizzle-orm`, which `packages/shared` does not depend on). The
 * test compiles pass-(a) fixtures ad hoc via `compileFixtureAdHoc` instead.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import ts from 'typescript'

/** The three static checks this tool performs. */
export type CoalesceRule = 'nullish-coalesce-zero' | 'sql-coalesce-zero' | 'column-default-zero'

/** One violation: exactly enough to name and locate it. */
export interface Finding {
  readonly file: string
  readonly line: number
  readonly snippet: string
  readonly rule: CoalesceRule
}

/**
 * The nullable numeric columns a `.default(0)` would silently zero-fill.
 * D7.1's five review counts plus daily-checkin's three and D26's
 * `clock_gap_seconds` and `feed_estimate_min` (also nullable, also money for
 * "unknown" vs "explicit 0").
 */
export const NULLABLE_NUMERIC_COLUMNS = [
  'episode_count',
  'external_count',
  'unplanned_agent_checks',
  'mind_wandering_count',
  'recall_score',
  'sleep_minutes',
  'stress',
  'mindfulness_minutes',
  'feed_estimate_min',
  'clock_gap_seconds',
] as const

const SQL_COALESCE_ZERO_RE = /coalesce\s*\([^)]*,\s*0\s*\)/i

const COLUMN_DEFAULT_ZERO_RE = new RegExp(
  `integer\\(\\s*['"](${NULLABLE_NUMERIC_COLUMNS.join('|')})['"]\\s*\\)[^\\n]*\\.default\\(\\s*0\\s*\\)`,
)

const SCANNED_EXTENSIONS = ['.ts', '.sql'] as const

function toPosixPath(path: string): string {
  return path.split('\\').join('/')
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/)
}

/**
 * `true` for a line that is entirely a comment — a `//` line comment, or
 * inside/starting/ending a `/* ... *\/` block comment (including a JSDoc `*`
 * continuation line) — so `scanTextForPattern` never flags a comment that
 * merely *documents* the anti-pattern (e.g. "never `?? 0` / `COALESCE(...,0)`
 * here") as an instance of it. Only ever called on `.ts` files: `.sql` files
 * have no comment syntax this tool needs to understand, and pass (a) (the
 * type-checked AST walk) is inherently comment-immune already, so this
 * exists only for passes (b)/(c)'s raw-text regexes. Mutates `state` (the
 * caller's block-comment tracker) as it goes; deliberately simple (no
 * awareness of a `/*`/`*\/` that itself appears inside a string literal) —
 * good enough for source that does not construct comment delimiters at
 * runtime, which none of this codebase's `.ts` files do.
 */
function isFullyCommentLine(line: string, state: { inBlockComment: boolean }): boolean {
  const trimmed = line.trim()

  if (state.inBlockComment) {
    if (trimmed.includes('*/')) state.inBlockComment = false
    return true
  }
  if (trimmed.startsWith('//')) return true
  if (trimmed.startsWith('/*')) {
    if (!trimmed.includes('*/')) state.inBlockComment = true
    return true
  }
  // A JSDoc continuation line, e.g. " * some text" (leading `*` with a
  // following space or end of line, never `*/` alone which the block-comment
  // branch above already consumed, nor `*=`/`**` which are real code).
  if (/^\*(\s|$)/.test(trimmed)) return true

  return false
}

function scanTextForPattern(filePath: string, text: string, pattern: RegExp, rule: CoalesceRule): Finding[] {
  const findings: Finding[] = []
  const lines = splitLines(text)
  const isTypeScript = extname(filePath) === '.ts'
  const commentState = { inBlockComment: false }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isComment = isTypeScript && isFullyCommentLine(line, commentState)
    if (!isComment && pattern.test(line)) {
      findings.push({ file: toPosixPath(filePath), line: i + 1, snippet: line.trim(), rule })
    }
  }
  return findings
}

/** Pass (b): a raw/drizzle `sql` template coalescing a count to 0. */
export function scanTextForSqlCoalesceZero(filePath: string, text: string): Finding[] {
  return scanTextForPattern(filePath, text, SQL_COALESCE_ZERO_RE, 'sql-coalesce-zero')
}

/** Pass (c): a nullable numeric column given a `.default(0)`. */
export function scanTextForColumnDefaultZero(filePath: string, text: string): Finding[] {
  return scanTextForPattern(filePath, text, COLUMN_DEFAULT_ZERO_RE, 'column-default-zero')
}

function isNumericZeroLiteral(expr: ts.Expression): boolean {
  return ts.isNumericLiteral(expr) && expr.text === '0'
}

/** A union that contains both a nullish member and a number member — a `ReportedCount`-shaped type. */
function isNullableNumberType(type: ts.Type): boolean {
  if (!type.isUnion()) return false
  let hasNullish = false
  let hasNumber = false
  for (const member of type.types) {
    if (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) hasNullish = true
    if (member.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) hasNumber = true
  }
  return hasNullish && hasNumber
}

/** Pass (a): walk one already-type-checked source file for `<nullable number> ?? 0` / `|| 0`. */
export function scanSourceFileForNullishCoalesceZero(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): Finding[] {
  const findings: Finding[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isNumericZeroLiteral(node.right)
    ) {
      const leftType = checker.getTypeAtLocation(node.left)
      if (isNullableNumberType(leftType)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        findings.push({
          file: toPosixPath(sourceFile.fileName),
          line: line + 1,
          snippet: node.getText(sourceFile).trim(),
          rule: 'nullish-coalesce-zero',
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

interface LoadedTsProgram {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  /** Absolute path to this tsconfig's `src` directory. */
  readonly srcDir: string
}

function readParsedConfig(tsconfigPath: string): { config: unknown; basePath: string } {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(
      `findZeroCoalesce: failed to read ${tsconfigPath}: ` +
        ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
    )
  }
  return { config: configFile.config, basePath: dirname(resolve(tsconfigPath)) }
}

/** Loads a package's real tsconfig and builds a program scoped to just its `src/**` files. */
function loadProgramFromTsconfig(tsconfigPath: string): LoadedTsProgram {
  const { config, basePath } = readParsedConfig(tsconfigPath)
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, basePath)
  const srcDir = join(basePath, 'src')
  const srcDirWithSep = srcDir + sep
  // Restrict root names to files under src/ so this pass never compiles or
  // reports on the package's own test files — this tool checks production
  // code, not itself.
  const srcFileNames = parsed.fileNames.filter((f) => resolve(f).startsWith(srcDirWithSep))
  const program = ts.createProgram({ rootNames: srcFileNames, options: parsed.options })
  return { program, checker: program.getTypeChecker(), srcDir }
}

export interface FixtureCompileResult {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  readonly sourceFile: ts.SourceFile
}

/**
 * Compiles a single fixture file ad hoc (outside any tsconfig's `include`),
 * resolving its imports normally, using a package's tsconfig only for
 * `compilerOptions`. Fixtures under `test/fixtures/coalesce/` are excluded
 * from `packages/shared/tsconfig.json`'s own project-wide typecheck, so this
 * is the only way pass (a) ever sees them.
 */
export function compileFixtureAdHoc(fixtureFilePath: string, tsconfigPath: string): FixtureCompileResult {
  const { config, basePath } = readParsedConfig(tsconfigPath)
  // Drop include/exclude/files so parseJsonConfigFileContent only resolves
  // `extends` and hands back compilerOptions — the fixture itself supplies
  // the one root file.
  const configForOptions =
    typeof config === 'object' && config !== null
      ? { ...(config as Record<string, unknown>), include: undefined, exclude: undefined, files: undefined }
      : config
  const parsed = ts.parseJsonConfigFileContent(configForOptions, ts.sys, basePath)
  const resolvedFixture = resolve(fixtureFilePath)
  const program = ts.createProgram({ rootNames: [resolvedFixture], options: parsed.options })

  const target = toPosixPath(resolvedFixture)
  const sourceFile = program.getSourceFiles().find((sf) => toPosixPath(resolve(sf.fileName)) === target)
  if (!sourceFile) {
    throw new Error(`findZeroCoalesce: could not compile fixture ${fixtureFilePath}`)
  }

  return { program, checker: program.getTypeChecker(), sourceFile }
}

function walkFiles(dir: string, extensions: readonly string[]): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, extensions))
    } else if (extensions.includes(extname(entry.name))) {
      results.push(full)
    }
  }
  return results
}

/**
 * Runs all three passes over the real source tree for every tsconfig path
 * given. A missing tsconfig (e.g. `apps/api/tsconfig.json` before group 3
 * exists) is skipped gracefully rather than thrown on, so this tool is
 * usable from the very first shared-only tasks onward.
 */
export function findZeroCoalesce(tsconfigPaths: readonly string[]): Finding[] {
  const findings: Finding[] = []

  for (const tsconfigPath of tsconfigPaths) {
    const resolvedTsconfig = resolve(tsconfigPath)
    if (!existsSync(resolvedTsconfig)) continue

    const { program, checker, srcDir } = loadProgramFromTsconfig(resolvedTsconfig)
    const srcDirWithSep = srcDir + sep

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      if (!resolve(sourceFile.fileName).startsWith(srcDirWithSep)) continue
      findings.push(...scanSourceFileForNullishCoalesceZero(sourceFile, checker))
    }

    if (existsSync(srcDir)) {
      for (const filePath of walkFiles(srcDir, SCANNED_EXTENSIONS)) {
        const text = readFileSync(filePath, 'utf8')
        findings.push(...scanTextForSqlCoalesceZero(filePath, text))
        findings.push(...scanTextForColumnDefaultZero(filePath, text))
      }
    }
  }

  return findings
}
