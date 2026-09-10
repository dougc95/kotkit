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
})
