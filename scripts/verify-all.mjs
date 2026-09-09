// Fresh-database full verification. Recreates the attention-lab-pg container
// from scratch, waits for Postgres to report ready, then runs the rest of
// the toolchain against it in order, stopping at the first failure. Node
// only (jq and python are not on PATH in this environment); no
// dependencies.
//
// Six tabulated stages:
//   1. database bring-up  — remove any existing container, `npm run db:up`,
//      poll `pg_isready` inside the container until it answers
//   2. db:push
//   3. typecheck
//   4. test
//   5. build
//   6. e2e
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

const CONTAINER = 'attention-lab-pg'
const PG_USER = 'attention'
const PG_DB = 'attention_lab'
const READY_TIMEOUT_MS = 60_000
const READY_POLL_INTERVAL_MS = 1_000

/**
 * Runs a command with stdio inherited (so the child's own output streams
 * straight to this process's terminal) and resolves with its exit code.
 * `shell: isWindows` lets this find `npm`, which on Windows is a `.cmd`
 * shim that Node cannot execute directly without a shell.
 */
function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', shell: isWindows })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}`))
        return
      }
      resolvePromise(code ?? 1)
    })
  })
}

/** Runs an npm script from the repo root with inherited stdio; throws on non-zero exit. */
async function runNpmScript(scriptName) {
  console.log(`\n> npm run ${scriptName}`)
  const code = await run('npm', ['run', scriptName])
  if (code !== 0) throw new Error(`npm run ${scriptName} exited with code ${code}`)
}

/** Removes any existing container of the given name. A missing container is expected, not an error. */
function removeContainerIfPresent(name) {
  spawnSync('docker', ['rm', '-f', name], { cwd: repoRoot, shell: isWindows, stdio: 'ignore' })
}

/** Polls `pg_isready` inside the running container until it succeeds or the timeout elapses. */
async function waitForPostgresReady(name, { timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', PG_USER, '-d', PG_DB], {
      cwd: repoRoot,
      shell: isWindows,
      stdio: 'ignore',
    })
    if (result.error) throw new Error(`Failed to run "docker exec ${name} pg_isready": ${result.error.message}`)
    if (result.status === 0) return
    if (Date.now() >= deadline) {
      throw new Error(`Postgres in container "${name}" did not report ready within ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

async function stageDatabaseBringUp() {
  console.log(`\n> removing any existing "${CONTAINER}" container`)
  removeContainerIfPresent(CONTAINER)
  console.log(`> npm run db:up (creating a fresh container)`)
  const code = await run('npm', ['run', 'db:up'])
  if (code !== 0) throw new Error(`npm run db:up exited with code ${code}`)
  console.log(`> waiting for pg_isready inside "${CONTAINER}"`)
  await waitForPostgresReady(CONTAINER, { timeoutMs: READY_TIMEOUT_MS, intervalMs: READY_POLL_INTERVAL_MS })
  console.log(`> Postgres is ready`)
}

const stages = [
  { name: 'database bring-up (fresh container + pg_isready wait)', run: stageDatabaseBringUp },
  { name: 'db:push', run: () => runNpmScript('db:push') },
  { name: 'typecheck', run: () => runNpmScript('typecheck') },
  { name: 'test', run: () => runNpmScript('test') },
  { name: 'build', run: () => runNpmScript('build') },
  { name: 'e2e', run: () => runNpmScript('e2e') },
]

function printSummaryTable(rows, overallFailed) {
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 'Stage'.length)
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 'STATUS'.length)
  const secondsWidth = Math.max(...rows.map((r) => r.seconds.toFixed(1).length), 'Seconds'.length)
  const rule = '-'.repeat(nameWidth + statusWidth + secondsWidth + 4)

  const line = (name, status, seconds) => `${name.padEnd(nameWidth)}  ${status.padEnd(statusWidth)}  ${seconds.padStart(secondsWidth)}`

  console.log(`\n=== verify:all summary (6 stages) ===`)
  console.log(line('Stage', 'STATUS', 'Seconds'))
  console.log(rule)
  for (const row of rows) console.log(line(row.name, row.status, row.seconds.toFixed(1)))
  console.log(rule)
  console.log(overallFailed ? 'RESULT: FAIL' : 'RESULT: PASS')
}

async function main() {
  const results = []
  let failed = false

  for (const stage of stages) {
    if (failed) {
      results.push({ name: stage.name, status: 'SKIPPED', seconds: 0 })
      continue
    }
    const startedAt = Date.now()
    try {
      await stage.run()
      results.push({ name: stage.name, status: 'PASS', seconds: (Date.now() - startedAt) / 1000 })
    } catch (err) {
      results.push({ name: stage.name, status: 'FAIL', seconds: (Date.now() - startedAt) / 1000 })
      console.error(`\n> "${stage.name}" FAILED: ${err.message}`)
      failed = true
    }
  }

  printSummaryTable(results, failed)
  process.exit(failed ? 1 : 0)
}

main()
