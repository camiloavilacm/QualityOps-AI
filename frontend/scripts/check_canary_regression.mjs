import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, save, tests as reportTests } from './foundation_report.mjs'
import { readInventory, validateReport } from './check_test_hygiene.mjs'
import { mutateExport } from './canary_mutation.mjs'

export { mutateExport } from './canary_mutation.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const boundedJSON = async path => { const info = await lstat(path); assert.ok(info.isFile() && !info.isSymbolicLink() && info.size < 4 * 1024 * 1024, 'Unsafe or oversized JSON report'); return JSON.parse(await readFile(path, 'utf8')) }
const envFor = overrides => ({ PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, ...overrides })
const pause = ms => new Promise(done => setTimeout(done, ms))

async function portFree(port) {
  const server = createServer()
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) }) }
  finally { await new Promise(done => server.close(done)) }
}
async function bundleDigests(root) {
  const result = {}
  async function walk(path) {
    const directoryInfo = await lstat(path)
    assert.ok(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink() && (directoryInfo.mode & 0o222) === 0, 'Bundle directory must be read-only')
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name), info = await lstat(child)
      assert.ok(!info.isSymbolicLink() && (info.mode & 0o222) === 0, 'Bundle content must be read-only and symlink-free')
      if (info.isDirectory()) await walk(child)
      else { assert.ok(info.isFile()); result[relative(root, child).split('\\').join('/')] = sha(await readFile(child)) }
    }
  }
  await walk(root)
  assert.ok(Object.keys(result).some(key => key.endsWith('.js')), 'Missing built JavaScript')
  return result
}
async function startServer(bundleRoot, port) {
  const root = await realpath(bundleRoot), record = { command: ['trusted-static-canary-server'], cwd: root, port, exit_code: null }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }
  const server = createHttpServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
      const parsed = new URL(request.url || '/', `http://127.0.0.1:${port}`)
      let pathname = decodeURIComponent(parsed.pathname)
      if (pathname === '/') pathname = '/index.html'
      let target = resolve(root, `.${pathname}`)
      if (target !== root && !target.startsWith(root + sep)) { response.writeHead(404).end(); return }
      let info
      try { info = await lstat(target) } catch { target = join(root, 'index.html'); info = await lstat(target) }
      if (info.isSymbolicLink() || !info.isFile() || info.size > 4 * 1024 * 1024) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream', 'content-length': info.size, 'x-content-type-options': 'nosniff' })
      if (request.method === 'HEAD') response.end()
      else response.end(await readFile(target))
    } catch { if (!response.headersSent) response.writeHead(400); response.end() }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
  return { server, record }
}
async function stopServer(server) {
  if (!server?.server.listening) return
  await new Promise((done, reject) => server.server.close(error => error ? reject(error) : done()))
  server.record.exit_code = 0
}
async function serverReady(server, port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    assert.ok(server.server.listening, 'Owned preview startup failed')
    try { const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); if (response.ok) return } catch { /* bounded startup polling */ }
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
  const summary = { schema_version: 'canary-1', result: 'FAIL', classification: 'INVALID', variants: {}, cleanup: { processes: 'NOT RUN', temporary_copies: 'NOT RUN' }, limitations: ['This single declared presentation mutant does not prove general assertion semantics or authorize merge.', 'Host diagnostics do not establish accepted container verification.'] }
  let browser, manifest
  const servers = []
  const originalCwd = process.cwd()
  try {
    process.chdir(root)
    const inventoryBytes = await readFile(join(root, 'tests/expected-tests.json'))
    const inventory = readInventory(JSON.parse(inventoryBytes))
    const entry = inventory.projects.chromium.tests.find(item => item.id === 'DASH-003')
    assert.ok(entry)
    summary.requirement = { project: 'chromium', id: entry.id, file: entry.file, titlePath: entry.titlePath, stepId: entry.stepId }
    const originalBytes = await readFile(join(root, 'src/showcase-export.json'))
    const lockBytes = await readFile(join(root, 'package-lock.json'))
    const specBytes = await readFile(join(root, entry.file))
    const prepared = resolve(root, '../canary-variants')
    manifest = await boundedJSON(join(prepared, 'manifest.json'))
    assert.equal(manifest.schema_version, 'canary-build-1')
    assert.equal(manifest.source_revision, process.env.PW_VERIFIER_REVISION)
    assert.equal(manifest.inventory_sha256, sha(inventoryBytes))
    assert.equal(manifest.lockfile_sha256, sha(lockBytes))
    assert.equal(manifest.original_export_sha256, sha(originalBytes))
    const verifierTests = await realpath(join(resolve(root, '..'), 'verifier-tests'))
    const verifierSpec = await readFile(join(verifierTests, 'mixed-campaign.spec.ts'))
    assert.equal(manifest.spec_sha256, sha(verifierSpec), 'Prepared variants must use verifier-owned test sources')
    assert.equal(manifest.temporary_copies, 'PASS')
    const mutatedBytes = await readFile(join(prepared, 'mutated-export.json'))
    assert.equal(manifest.mutated_export_sha256, sha(mutatedBytes))
    await mkdir(join(output, 'mutation'))
    await writeFile(join(output, 'mutation/mutated-export.json'), mutatedBytes)
    summary.inputs = { source_revision: process.env.PW_VERIFIER_REVISION ?? inventory.sourceRevision,
      inventory_sha256: sha(inventoryBytes), original_export_sha256: sha(originalBytes),
      spec_sha256: sha(specBytes), prepared_spec_sha256: manifest.spec_sha256, lockfile_sha256: sha(lockBytes) }
    summary.mutation = { ...manifest.mutation, original_export_sha256: sha(originalBytes),
      mutated_export_sha256: sha(mutatedBytes), snapshot: 'mutation/mutated-export.json' }
    await portFree(4184); await portFree(4185)
    for (const variant of ['positive', 'mutated']) {
      const evidence = join(output, variant)
      await mkdir(evidence)
      const bundle = join(prepared, variant)
      const preparedHashes = await bundleDigests(bundle)
      assert.deepEqual(preparedHashes, manifest.variants[variant].bundle_sha256, 'Prepared read-only bundle digest mismatch')
      const record = summary.variants[variant] = { project: 'chromium', identity: summary.requirement,
        export_sha256: manifest.variants[variant].export_sha256, bundle_sha256: preparedHashes,
        commands: [...manifest.variants[variant].commands], discovery: `${variant}/discovery.json`, report: `${variant}/report.json` }
      const port = variant === 'positive' ? 4184 : 4185
      const server = await startServer(bundle, port); servers.push(server)
      await serverReady(server, port)
      record.server = server.record
      browser ??= await chromium.launch({ channel: 'chromium', chromiumSandbox: true, args: ['--enable-features=WebMCP'] })
      assert.equal(browser.version(), '159.0.8154.6')
      summary.browser = browser.version()
      const reasons = variant === 'positive' ? [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }, { code: 'INSUFFICIENT_EVIDENCE', execution_id: 'y' }] : [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }]
      record.precheck = await uiPrecheck(port, { decision: 'BLOCKED', reasons, reason_count: reasons.length }, browser)
      const env = envFor({ PW_BASE_URL: `http://127.0.0.1:${port}`, PW_OUTPUT_DIR: join(evidence, 'test-results'), PLAYWRIGHT_JSON_OUTPUT_FILE: join(evidence, 'discovery.json') })
      const args = ['node_modules/@playwright/test/cli.js', 'test', '--project=chromium', entry.file.replace(/^tests\//, ''), '--reporter=json']
      let child = await run([...args, '--list'], env)
      record.commands.push({ ...child, cwd: root })
      record.discovery_exit_code = child.exit_code
      assert.equal(child.exit_code, 0, 'Canary discovery failed'); assert.equal(child.timedOut, false)
      const singleInventory = { ...inventory, projects: { ...inventory.projects, chromium: { ...inventory.projects.chromium, count: 1, tests: [entry] } } }
      await validateReport(await boundedJSON(join(evidence, 'discovery.json')), 'chromium', singleInventory)
      env.PLAYWRIGHT_JSON_OUTPUT_FILE = join(evidence, 'report.json')
      child = await run(args, env)
      record.commands.push({ ...child, cwd: root })
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
    summary.cleanup.temporary_copies = manifest?.temporary_copies === 'PASS' ? 'PASS' : 'FAIL'
    if (summary.cleanup.temporary_copies !== 'PASS') { summary.result = 'FAIL'; summary.classification = 'INVALID' }
    await save(join(output, 'summary.json'), summary)
  }
  return summary
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  let output
  if (args.length === 2 && args[0] === '--output') output = args[1]
  else if (args.length === 0) output = process.env.PW_CANARY_OUTPUT_DIR || join(here, 'artifacts/canary')
  else throw new Error('Use no arguments with PW_CANARY_OUTPUT_DIR, or --output <fresh-directory>')
  runCanary({ output }).then(result => { console.log(result.result, result.classification); process.exitCode = result.result === 'PASS' ? 0 : 1 }).catch(error => { console.error(String(error)); process.exitCode = 1 })
}
