import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scanText, scanTree } from './copyGuard.js'

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('copy guard', () => {
  it('copy guard passes on the current tree', () => {
    expect(scanTree(SRC_ROOT)).toEqual([])
  })

  it('copy guard scanner flags an inline fixture containing "streak" and ignores the same word inside a comment', () => {
    const liveCopy = `export const encouragement = "Don't lose your STREAK!"`
    const commentedOnly = ['// a streak is never shown to users', "export const label = 'Fewer reported switches'"].join(
      '\n',
    )

    expect(scanText(liveCopy)).toContain('streak')
    expect(scanText(commentedOnly)).toEqual([])
  })
})
