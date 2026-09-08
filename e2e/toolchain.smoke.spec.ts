import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('axe builder resolves @toolchain', () => {
  expect(typeof AxeBuilder).toBe('function')
})
