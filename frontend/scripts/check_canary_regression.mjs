import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { run, save, tests as reportTests } from './foundation_report.mjs'
import { readInventory, validateReport } from './check_test_hygiene.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const boundedJSON = async path => { assert.ok((await stat(path)).size < 4 * 1024 * 1024, 'Oversized JSON report'); return JSON.parse(await readFile(path, 'utf8')) }
const envFor = overrides => ({ PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, ...overrides })
const pause = ms => new Promise(done => setTimeout(done, ms))

export function mutateExport(original) {
  const mutated = structuredClone(original)
  const source = original.campaigns.filter(item => item.id === 'fixture-mixed')
  assert.equal(source.length, 1, 'Exactly one mixed campaign')
  const removed = source[0].gate.reasons.filter(item => item.code === 'INSUFFICIENT_EVIDENCE')
  assert.equal(removed.length, 1, 'Exactly one missing-evidence reason')
  assert.equal(source[0].gate.decision, 'BLOCKED')
  const target = mutated.campaigns.find(item => item.id === 'fixture-mixed')
  target.gate.reasons = target.gate.reasons.filter(item => item.code !== 'INSUFFICIENT_EVIDENCE')
  assert.equal(target.gate.reasons.length, source[0].gate.reasons.length - 1)
  assert.ok(target.gate.reasons.some(item => item.code === 'REQUIRED_FAILURE'))
  const restored = structuredClone(mutated)
  restored.campaigns.find(item => item.id === 'fixture-mixed').gate.reasons = structuredClone(source[0].gate.reasons)
  assert.deepEqual(restored, original, 'No other export difference allowed')
  return { mutated, removedReason: removed[0] }
}
async function portFree(port) {
  const server = createServer()
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) }) }
  finally { await new Promise(done => server.close(done)) }
}
async function bundleDigests(root) {
  const result = {}
  async function walk(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const child = join(path, entry.name); assert.ok(!entry.isSymbolicLink(), 'Bundle symlink'); if (entry.isDirectory()) await walk(child); else { assert.ok(entry.isFile()); result[relative(root, child).split('\\').join('/')] = sha(await readFile(child)) } } }
  await walk(root)
  assert.ok(Object.keys(result).some(key => key.endsWith('.js')), 'Missing built JavaScript')
  return result
}
function startServer(cwd, port) {
  const command = [process.execPath, 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--strictPort', '--port', String(port)]
  const child = spawn(command[0], command.slice(1), { cwd, env: envFor({}), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const record = { command, cwd, exit_code: null, output: '' }
  const collect = bytes => { record.output += bytes.toString().slice(0, Math.max(0, 32_000 - record.output.length)) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  let startupError
  child.once('error', error => { startupError = error })
  child.once('close', code => { record.exit_code = code })
  return { child, record, startupError: () => startupError }
}
async function stopServer(server) {
  if (!server) return
  if (server.child.exitCode !== null || server.child.signalCode !== null) return
  const exited = new Promise(done => server.child.once('close', done))
  try { process.kill(-server.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await Promise.race([exited, pause(2_000)])
  if (server.child.exitCode === null && server.child.signalCode === null) {
    try { process.kill(-server.child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    await Promise.race([exited, pause(2_000)])
  }
  assert.ok(server.child.exitCode !== null || server.child.signalCode !== null, 'Owned preview process did not stop')
}
async function serverReady(server, port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    assert.ok(!server.startupError() && server.child.exitCode === null && server.child.signalCode === null, 'Owned preview startup failed')
    try { const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); if (response.ok && server.record.output.includes(String(port))) return } catch { /* bounded startup polling */ }
    await pause(50)
  }
  throw new Error('Preview startup timed out')
}
async function uiPrecheck(port, expected, browser) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/?campaign=fixture-mixed`)
    await page.locator('.decision-value').waitFor()
    const decision = await page.locator('.decision-value').innerText()
    const rows = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')
    const reasons = []
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index)
      const code = await row.locator('.reason-evidence > code').innerText()
      const execution_id = await row.locator('.reason-main p code').innerText()
      assert.ok(['REQUIRED_FAILURE', 'INSUFFICIENT_EVIDENCE', 'ALL_REQUIRED_PASSED'].includes(code) && execution_id, 'Unrecognized rendered reason')
      reasons.push({ code, execution_id })
    }
    const observed = { decision, reasons, reason_count: reasons.length }
    assert.deepEqual(observed, expected, 'Rendered mutation precheck failed')
    return observed
  } finally { await context.close() }
}
const failedSteps = result => {
  const names = []
  function visit(steps) { for (const step of steps ?? []) { if (step.error) names.push(step.title); visit(step.steps) } }
  visit(result.steps)
  return names
}
export function validateCanaryExecution(report, entry, mutated) {
  assert.deepEqual(report.errors ?? [], [], 'Runner fatal error')
  const rows = reportTests(report)
  assert.equal(rows.length, 1, 'Exactly DASH-003 must execute')
  const row = rows[0]
  assert.equal(row.projectName, 'chromium')
  assert.equal(`tests/${row.file}`, entry.file)
  assert.deepEqual(row.titlePath.slice(1), entry.titlePath)
  assert.equal(row.expectedStatus, 'passed')
  assert.equal(row.results.length, 1)
  const result = row.results[0]
  assert.equal(result.retry, 0)
  assert.equal(result.status, mutated ? 'failed' : 'passed')
  assert.equal(row.status, mutated ? 'unexpected' : 'expected')
  const failed = failedSteps(result)
  if (mutated) {
    assert.deepEqual(failed, [entry.stepId], 'Only designated assertion step may fail')
    assert.equal(result.errors.length, 1, 'One attributed assertion error')
    assert.ok(result.errors[0].message.includes('Insufficient evidence'), 'Missing-evidence assertion attribution')
    assert.ok(!result.errors[0].message.includes('DASHBOARD_GUARD'), 'Guard failures cannot kill mutant')
  } else { assert.deepEqual(failed, []); assert.deepEqual(result.errors ?? [], []) }
  return { execution_status: result.status, failed_steps: failed }
}

export async function runCanary({ root = here, output }) {
  root = resolve(root); output = resolve(output)
  await mkdir(output, { recursive: true })
  assert.deepEqual(await readdir(output), [], 'Canary output must be fresh')
  const summary = { schema_version: 'canary-1', result: 'FAIL', classification: 'INVALID', variants: {}, cleanup: { processes: 'NOT RUN', temporary_copies: 'NOT RUN' }, limitations: ['This single declared presentation mutant does not prove general assertion semantics or authorize merge.', 'Host development diagnostics do not establish accepted container verification.'] }
  let temp, browser
  const servers = []
  const originalCwd = process.cwd()
  try {
    const inventoryBytes = await readFile(join(root, 'tests/expected-tests.json'))
    const inventory = readInventory(JSON.parse(inventoryBytes))
    const entry = inventory.projects.chromium.tests.find(item => item.id === 'DASH-003')
    assert.ok(entry)
    summary.requirement = { project: 'chromium', id: entry.id, file: entry.file, titlePath: entry.titlePath, stepId: entry.stepId }
    const originalBytes = await readFile(join(root, 'src/showcase-export.json'))
    assert.ok(originalBytes.length < 2 * 1024 * 1024, 'Export bound')
    const original = JSON.parse(originalBytes), { mutated, removedReason } = mutateExport(original)
    const mutatedBytes = Buffer.from(JSON.stringify(mutated, null, 2) + '\n')
    await mkdir(join(output, 'mutation'))
    await writeFile(join(output, 'mutation/mutated-export.json'), mutatedBytes)
    summary.inputs = { source_revision: process.env.PW_VERIFIER_REVISION ?? inventory.sourceRevision, inventory_sha256: sha(inventoryBytes), original_export_sha256: sha(originalBytes), spec_sha256: sha(await readFile(join(root, entry.file))), lockfile_sha256: sha(await readFile(join(root, 'package-lock.json'))) }
    summary.mutation = { campaign_id: 'fixture-mixed', removed_reason: removedReason, removed_count: 1, exact_delta: true, original_export_sha256: sha(originalBytes), mutated_export_sha256: sha(mutatedBytes), snapshot: 'mutation/mutated-export.json' }
    await portFree(4184); await portFree(4185)
    temp = await mkdtemp(join(tmpdir(), 'qualityops-canary-'))
    for (const [variant, bytes] of [['positive', originalBytes], ['mutated', mutatedBytes]]) {
      const workspace = join(temp, variant)
      await mkdir(workspace)
      for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts', 'index.html', 'src', 'tests', 'scripts', 'types', 'node_modules']) await cp(join(root, file), join(workspace, file), { recursive: true, dereference: false, verbatimSymlinks: true })
      await writeFile(join(workspace, 'src/showcase-export.json'), bytes)
      const evidence = join(output, variant)
      await mkdir(evidence)
      const record = summary.variants[variant] = { project: 'chromium', identity: summary.requirement, export_sha256: sha(await readFile(join(workspace, 'src/showcase-export.json'))), commands: [], discovery: `${variant}/discovery.json`, report: `${variant}/report.json` }
      process.chdir(workspace)
      const buildCommand = ['node_modules/typescript/bin/tsc', '--noEmit']
      let child = await run(buildCommand, envFor({}))
      record.commands.push({ ...child, cwd: workspace })
      assert.equal(child.exit_code, 0, 'Canary typecheck failed'); assert.equal(child.timedOut, false)
      child = await run(['node_modules/vite/bin/vite.js', 'build', '--base=./'], envFor({}))
      record.commands.push({ ...child, cwd: workspace })
      assert.equal(child.exit_code, 0, 'Canary build failed'); assert.equal(child.timedOut, false)
      record.bundle_sha256 = await bundleDigests(join(workspace, 'dist'))
      const port = variant === 'positive' ? 4184 : 4185
      const server = startServer(workspace, port); servers.push(server)
      await serverReady(server, port)
      record.server = server.record
      browser ??= await chromium.launch({ channel: 'chromium', chromiumSandbox: true, args: ['--enable-features=WebMCP'] })
      assert.equal(browser.version(), '159.0.8154.6')
      summary.browser = browser.version()
      const reasons = variant === 'positive' ? [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }, { code: 'INSUFFICIENT_EVIDENCE', execution_id: 'y' }] : [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }]
      record.precheck = await uiPrecheck(port, { decision: 'BLOCKED', reasons, reason_count: reasons.length }, browser)
      const env = envFor({ PW_BASE_URL: `http://127.0.0.1:${port}`, PW_OUTPUT_DIR: join(evidence, 'test-results'), PLAYWRIGHT_JSON_OUTPUT_FILE: join(evidence, 'discovery.json') })
      const args = ['node_modules/@playwright/test/cli.js', 'test', '--project=chromium', entry.file.replace(/^tests\//, ''), '--reporter=json']
      child = await run([...args, '--list'], env)
      record.commands.push({ ...child, cwd: workspace })
      record.discovery_exit_code = child.exit_code
      assert.equal(child.exit_code, 0, 'Canary discovery failed'); assert.equal(child.timedOut, false)
      const singleInventory = { ...inventory, projects: { ...inventory.projects, chromium: { ...inventory.projects.chromium, count: 1, tests: [entry] } } }
      await validateReport(await boundedJSON(join(evidence, 'discovery.json')), 'chromium', singleInventory)
      env.PLAYWRIGHT_JSON_OUTPUT_FILE = join(evidence, 'report.json')
      child = await run(args, env)
      record.commands.push({ ...child, cwd: workspace })
      record.execution_exit_code = child.exit_code
      assert.equal(child.timedOut, false)
      const report = await boundedJSON(join(evidence, 'report.json'))
      const rawResults = reportTests(report)
      record.execution_status = rawResults.length === 1 ? rawResults[0].results?.[0]?.status : 'invalid'
      record.failed_steps = rawResults.length === 1 && rawResults[0].results?.[0] ? failedSteps(rawResults[0].results[0]) : []
      Object.assign(record, validateCanaryExecution(report, entry, variant === 'mutated'))
      assert.equal(child.exit_code, variant === 'positive' ? 0 : 1, 'Unexpected runner exit')
      record.discovery_sha256 = sha(await readFile(join(evidence, 'discovery.json')))
      record.report_sha256 = sha(await readFile(join(evidence, 'report.json')))
      await stopServer(server)
    }
    assert.notDeepEqual(summary.variants.positive.bundle_sha256, summary.variants.mutated.bundle_sha256, 'Mutation must affect built bundle')
    summary.result = 'PASS'; summary.classification = 'KILLED'
  } catch (error) {
    summary.reason = String(error).slice(0, 2000)
    if (summary.variants.mutated?.execution_status === 'passed') summary.classification = 'SURVIVED'
  } finally {
    process.chdir(originalCwd)
    try { await browser?.close(); for (const server of servers) await stopServer(server); summary.cleanup.processes = 'PASS' } catch { summary.cleanup.processes = 'FAIL'; summary.result = 'FAIL'; summary.classification = 'INVALID' }
    try { if (temp) await rm(temp, { recursive: true, force: true }); summary.cleanup.temporary_copies = 'PASS' } catch { summary.cleanup.temporary_copies = 'FAIL'; summary.result = 'FAIL'; summary.classification = 'INVALID' }
    await save(join(output, 'summary.json'), summary)
  }
  return summary
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  assert.equal(args.length, 2); assert.equal(args[0], '--output')
  runCanary({ output: args[1] }).then(result => { console.log(result.result, result.classification); process.exitCode = result.result === 'PASS' ? 0 : 1 }).catch(error => { console.error(String(error)); process.exitCode = 1 })
}
