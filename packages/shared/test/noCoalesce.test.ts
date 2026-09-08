import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileFixtureAdHoc,
  findZeroCoalesce,
  scanSourceFileForNullishCoalesceZero,
  scanTextForColumnDefaultZero,
  scanTextForSqlCoalesceZero,
} from './tools/findZeroCoalesce.js'

const sharedTsconfigPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
const apiTsconfigPath = fileURLToPath(new URL('../../../apps/api/tsconfig.json', import.meta.url))

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/coalesce/${name}`, import.meta.url))
}

/** Locates the 1-indexed line of `needle` in `text`, so tests never hardcode magic line numbers. */
function lineOf(text: string, needle: string): number {
  const index = text.indexOf(needle)
  if (index === -1) throw new Error(`fixture is missing expected snippet: ${needle}`)
  return text.slice(0, index).split(/\r\n|\n/).length
}

describe('findZeroCoalesce: unknown-count guard (2.9.1)', () => {
  it('fixture `count ?? 0` where count: ReportedCount is reported with file and line', () => {
    const path = fixturePath('nullableCoalesce.ts')
    const text = readFileSync(path, 'utf8')
    const { sourceFile, checker } = compileFixtureAdHoc(path, sharedTsconfigPath)

    const findings = scanSourceFileForNullishCoalesceZero(sourceFile, checker)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'nullish-coalesce-zero',
      line: lineOf(text, 'count ?? 0'),
    })
    expect(findings[0]!.file).toContain('nullableCoalesce.ts')
  })

  it('fixture `n || 0` where n: number (non-nullable) is not reported', () => {
    const path = fixturePath('nonNullableOr.ts')
    const { sourceFile, checker } = compileFixtureAdHoc(path, sharedTsconfigPath)

    const findings = scanSourceFileForNullishCoalesceZero(sourceFile, checker)

    expect(findings).toEqual([])
  })

  it('fixture sql template COALESCE(episode_count, 0) is reported', () => {
    const path = fixturePath('sqlTemplate.ts')
    const text = readFileSync(path, 'utf8')

    const findings = scanTextForSqlCoalesceZero(path, text)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'sql-coalesce-zero',
      line: lineOf(text, 'COALESCE(episode_count, 0)'),
    })
    expect(findings[0]!.file).toContain('sqlTemplate.ts')
  })

  it("fixture integer('recall_score').default(0) is reported", () => {
    const path = fixturePath('columnDefault.ts')
    const text = readFileSync(path, 'utf8')

    const findings = scanTextForColumnDefaultZero(path, text)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'column-default-zero',
      line: lineOf(text, "integer('recall_score').default(0)"),
    })
    expect(findings[0]!.file).toContain('columnDefault.ts')
  })

  it('current tree: zero findings across packages/shared/src and apps/api/src (skips apps/api gracefully when its tsconfig is absent)', () => {
    const findings = findZeroCoalesce([sharedTsconfigPath, apiTsconfigPath])

    expect(findings).toEqual([])
  })
})
