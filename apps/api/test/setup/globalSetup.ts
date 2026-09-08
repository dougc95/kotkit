import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { bootstrapTestDb } from '../../scripts/bootstrap-test-db.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRootEnvPath = resolve(here, '../../../../.env')

export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile(repoRootEnvPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await bootstrapTestDb(process.env)
}
