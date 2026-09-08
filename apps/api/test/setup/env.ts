import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRootEnvPath = resolve(here, '../../../../.env')

try {
  process.loadEnvFile(repoRootEnvPath)
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}
