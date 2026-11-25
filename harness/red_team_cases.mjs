import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extname, sep } from 'node:path'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { checkConfiguration, checkOrdinarySource, readInventory, scanTree, validateReport } from '../frontend/scripts/check_test_hygiene.mjs'
import { validateCanaryExecution } from '../frontend/scripts/check_canary_regression.mjs'
import { run as runChild, tests as playwrightTests } from '../frontend/scripts/foundation_report.mjs'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const frontend = join(repo, 'frontend')
export async function createCaseWorkspace() {
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-red-team-'))
  const root = join(temp, 'frontend')
  const workflow = await readFile(join(repo, '.github/workflows/ci.yml'), 'utf8')
  await mkdir(root)
  for (const file of ['tests', 'playwright.config.ts', 'package.json'])
    await cp(join(frontend, file), join(root, file), { recursive: true })
  await mkdir(join(temp, '.github/workflows'), { recursive: true })
  await writeFile(join(temp, '.github/workflows/ci.yml'), workflow)
  return { temp, root }
}

export async function removeCaseWorkspace(temp) {
  await rm(temp, { recursive: true, force: true })
}

function rejects(source, expected) { assert.throws(() => checkOrdinarySource('tests/mixed-campaign.spec.ts', source), expected) }
const specPath = root => join(root, 'tests/mixed-campaign.spec.ts')
const originalSpec = root => readFile(specPath(root), 'utf8')
const configSource = root => readFile(join(root, 'playwright.config.ts'), 'utf8')
const packageSource = root => readFile(join(root, 'package.json'), 'utf8').then(JSON.parse)
const workflowSource = root => readFile(join(root, '../.github/workflows/ci.yml'), 'utf8')
async function rejectsScan(root, mutator, expected) {
  await mutator(root)
  await assert.rejects(scanTree(root), expected)
}

async function rejectsScopeEdit(file) {
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-red-team-scope-'))
  try {
    const git = (...args) => {
      const result = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
        { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      assert.equal(result.status, 0, 'fixture git operation failed')
      return result.stdout.trim()
    }
    git('init', '-q')
    await mkdir(join(temp, 'frontend/tests'), { recursive: true })
    await writeFile(join(temp, 'frontend/tests/mixed-campaign.spec.ts'), 'reviewed')
    if (file === 'workflow') {
      await mkdir(join(temp, '.github/workflows'), { recursive: true })
      await writeFile(join(temp, '.github/workflows/ci.yml'), 'reviewed')
    } else {
      await mkdir(join(temp, 'frontend/scripts'), { recursive: true })
      await writeFile(join(temp, 'frontend/scripts/check_test_hygiene.mjs'), 'reviewed')
    }
    git('add', '-A'); git('commit', '-qm', 'baseline')
    const baseline = git('rev-parse', 'HEAD')
    await writeFile(join(temp, file === 'workflow' ? '.github/workflows/ci.yml' : 'frontend/scripts/check_test_hygiene.mjs'), 'tampered')
    git('add', '-A'); git('commit', '-qm', 'candidate')
    const candidate = git('rev-parse', 'HEAD')
    const harness = join(repo, 'harness')
    const snippet = `import sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(harness)}); from check_healer_scope import check_scope; check_scope(Path(${JSON.stringify(temp)}), ${JSON.stringify(baseline)}, ${JSON.stringify(candidate)})`
    const result = spawnSync('python3', ['-B', '-c', snippet], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.notEqual(result.status, 0, 'trusted scope must reject the infrastructure edit')
    assert.match(result.stderr, /outside approved ordinary-spec modification scope/)
  } finally { await rm(temp, { recursive: true, force: true }) }
}

async function serveBuild(directory) {
  const root = await realpath(directory)
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json' }
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/') pathname = '/index.html'
      let target = resolve(root, `.${pathname}`)
      if (target !== root && !target.startsWith(root + sep)) { response.writeHead(404).end(); return }
      let info
      try { info = await lstat(target) } catch { target = join(root, 'index.html'); info = await lstat(target) }
      if (info.isSymbolicLink() || !info.isFile() || info.size > 8 * 1024 * 1024) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream',
        'content-length': info.size, 'x-content-type-options': 'nosniff' })
      if (request.method === 'HEAD') response.end()
      else createReadStream(target).pipe(response)
    } catch { if (!response.headersSent) response.writeHead(400); response.end() }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { baseURL: `http://127.0.0.1:${address.port}`, close: () => new Promise((done, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : done())
  }) }
}

async function treeDigest(root) {
  const hash = createHash('sha256')
  let total = 0
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name), info = await lstat(file)
      assert.ok(!info.isSymbolicLink(), 'R7 build bundle cannot contain symlinks')
      if (info.isDirectory()) await walk(file)
      else {
        assert.ok(info.isFile() && info.size <= 8 * 1024 * 1024)
        total += info.size; assert.ok(total <= 64 * 1024 * 1024)
        hash.update(file.slice(root.length + 1)).update('\0').update(await readFile(file)).update('\0')
      }
    }
  }
  await walk(root)
  return hash.digest('hex')
}

async function runR7BrowserControl(root, artifactDirectory) {
  const source = await originalSpec(root)
  assert.match(source, /name: \/fixture-mixed\/i/, 'candidate repair must select the campaign by its stable ID')
  const builds = [join(frontend, 'dist'), '/opt/qualityops/r7-dist']
  const inventory = readInventory(JSON.parse(await readFile(join(root, 'tests/expected-tests.json'), 'utf8')))
  const focused = structuredClone(inventory)
  focused.projects.chromium.tests = focused.projects.chromium.tests.filter(row => row.id === 'DASH-003')
  focused.projects.chromium.count = focused.projects.chromium.tests.length
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-r7-browser-'))
  const digests = { baseline: await treeDigest(builds[0]), renamed_control: await treeDigest(builds[1]),
    candidate_spec: createHash('sha256').update(source).digest('hex') }
  assert.notEqual(digests.baseline, digests.renamed_control, 'R7 UI variant must change the built bundle')
  const priorCwd = process.cwd()
  const outcomes = []
  const reports = []
  const diagnosticSummary = report => {
    const rows = playwrightTests(report)
    const allowed = new Set(['passed', 'failed', 'skipped', 'timedOut', 'interrupted', 'expected', 'unexpected'])
    const safe = value => typeof value === 'string' && allowed.has(value) ? value : 'OTHER'
    return { report_error_count: Math.min(Array.isArray(report.errors) ? report.errors.length : 0, 10),
      test_count: rows.length, tests: rows.slice(0, 5).map(test => ({
        expected_title_match: test.title === 'mixed campaign displays BLOCKED with confirmed failure for x and missing evidence for y',
        expected_file_match: test.file === 'mixed-campaign.spec.ts',
        expected_project_match: test.projectName === 'chromium',
        expected_status: safe(test.expectedStatus), status: safe(test.status),
        attempt_count: Math.min(Array.isArray(test.results) ? test.results.length : 0, 10),
        result_status: safe(test.results?.[0]?.status), retry: Number.isInteger(test.results?.[0]?.retry) ? test.results[0].retry : -1,
      })) }
  }
  const fail = async (variant, code, details, output) => {
    const evidence = { variant, reason_code: code, ...details }
    if (output) {
      try {
        const reportPath = join(output, 'report.json')
        const reportInfo = await lstat(reportPath)
        if (!reportInfo.isFile() || reportInfo.isSymbolicLink() || reportInfo.size > 8 * 1024 * 1024) throw new Error('invalid report file')
        const reportBytes = await readFile(reportPath)
        evidence.report_sha256 = createHash('sha256').update(reportBytes).digest('hex')
      } catch {}
      const testResults = join(output, 'test-results')
      let trace
      try {
        const found = []
        let entriesSeen = 0
        async function findTraces(directory, depth = 0) {
          assert.ok(depth <= 8, 'failure artifact depth exceeded')
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            assert.ok(++entriesSeen <= 1024, 'failure artifact count exceeded')
            const path = join(directory, entry.name)
            const info = await lstat(path)
            if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('unsafe test artifact')
            if (info.isDirectory()) await findTraces(path, depth + 1)
            else if (entry.name === 'trace.zip') found.push(path)
          }
        }
        await findTraces(testResults)
        assert.ok(found.length <= 1, 'unexpected number of failure traces')
        if (found.length === 1) {
          const info = await lstat(found[0])
          assert.ok(info.size <= 16 * 1024 * 1024, 'failure trace exceeds size limit')
          const bytes = await readFile(found[0])
          trace = { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
          evidence.trace_sha256 = trace.sha256
        }
      } catch { evidence.trace_collection = 'REJECTED' }
      if (trace) await writeFile(join(artifactDirectory, `${variant}-trace.zip`), trace.bytes, { flag: 'wx', mode: 0o600 })
    }
    await writeFile(join(artifactDirectory, `${variant}-failure.json`), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    const error = new Error('R7 browser control did not pass')
    error.evidence = [`${variant}-failure.json`, ...(evidence.trace_sha256 ? [`${variant}-trace.zip`] : [])]
    throw error
  }
  try {
    for (const [name, build] of [['baseline', builds[0]], ['renamed_control', builds[1]]]) {
      const server = await serveBuild(build)
      const output = join(temp, name)
      await mkdir(output)
      const reportPath = join(output, 'report.json')
      const env = { ...process.env, CI: '1', PW_BASE_URL: server.baseURL,
        PW_OUTPUT_DIR: join(output, 'test-results'), PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }
      process.chdir(frontend)
      const child = await runChild([join(frontend, 'node_modules/@playwright/test/cli.js'), 'test',
        'tests/mixed-campaign.spec.ts', '--project=chromium', '--reporter=json', '--retries=0'], env, 180_000)
      await server.close()
      let reportBytes, report
      try {
        const info = await lstat(reportPath)
        assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 8 * 1024 * 1024)
        reportBytes = await readFile(reportPath); report = JSON.parse(reportBytes)
      }
      catch { await fail(name, 'REPORT_INVALID', { timed_out: child.timedOut, exit_code: child.exit_code }, output) }
      const reportHash = createHash('sha256').update(reportBytes).digest('hex')
      const diagnostics = diagnosticSummary(report)
      try {
        assert.equal(child.timedOut, false)
        assert.equal(child.exit_code, 0)
        const count = await validateReport(report, 'chromium', focused, true)
        assert.equal(count, 1)
        const test = playwrightTests(report)[0]
        assert.ok(test)
        assert.equal(test.title, 'mixed campaign displays BLOCKED with confirmed failure for x and missing evidence for y')
        assert.equal(test.file, 'mixed-campaign.spec.ts')
        const sanitized = { schema_version: 'r7-playwright-report-1', variant: name,
          report_sha256: reportHash, test: { title: test.title, file: test.file,
            project: 'chromium', expected_status: test.expectedStatus, status: test.status,
            retries: test.results.length - 1 }, result: 'PASS' }
        const reportName = `${name}-report.json`
        await writeFile(join(artifactDirectory, reportName), JSON.stringify(sanitized, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        outcomes.push({ variant: name, status: 'PASS', tests: count, report_sha256: reportHash })
        reports.push(`R7/${reportName}`)
      } catch {
        const reasonCode = child.timedOut ? 'PLAYWRIGHT_TIMEOUT' : child.exit_code === 0 ? 'REPORT_INVALID' : 'PLAYWRIGHT_FAILED'
        await fail(name, reasonCode, { timed_out: child.timedOut, exit_code: child.exit_code,
          report_sha256: reportHash, diagnostics }, output)
      }
    }
    return { result: 'PASS', locator: 'fixture-mixed', original: outcomes[0], renamed_control: outcomes[1],
      playwright_reports: reports,
      artifact_sha256: digests,
      assertion_minimum: 7, behavior: ['BLOCKED', 'REQUIRED_FAILURE', 'INSUFFICIENT_EVIDENCE'] }
  } finally {
    process.chdir(priorCwd)
    await rm(temp, { recursive: true, force: true })
  }
}

export const localCases = [
  { id: 'R1a', title: 'unapproved spec extension rejected', run: ({ root }) => rejectsScan(root, root => writeFile(join(root, 'tests/hidden.spec.ts'), "test('hidden',()=>{})"), /Unapproved test\/helper file/) },
  { id: 'R1b', title: 'undiscovered test extension rejected', run: ({ root }) => rejectsScan(root, root => writeFile(join(root, 'tests/hidden.test.ts'), "test('hidden',()=>{})"), /Unapproved test\/helper file/) },
  { id: 'R2', title: 'workflow failure suppression rejected', run: async ({ root }) => {
    const [config, pkg, workflow] = await Promise.all([configSource(root), packageSource(root), workflowSource(root)])
    assert.throws(() => checkConfiguration(config, pkg, workflow + '\ncontinue-on-error: true'), /Workflow bypass/)
    await rejectsScopeEdit('workflow')
  } },
  { id: 'R3', title: 'recursive helper escape rejected', run: async ({ root }) => {
    await rejectsScan(root, async root => {
      await mkdir(join(root, 'tests/helpers'), { recursive: true })
      await writeFile(join(root, 'tests/helpers/escape.ts'), 'process.exit(0)')
    }, /Unapproved test\/helper file/)
    rejects((await originalSpec(root)).replace('  await page.goto', '  await page.evaluate(() => true)\n  await page.goto'), /Execution escape|Unapproved call/)
  } },
  { id: 'R4', title: 'assertion deletion rejected', run: ({ root }) => rejectsScan(root, async root => {
    const path = specPath(root)
    await writeFile(path, (await readFile(path, 'utf8')).replace("  await expect(reasons).toHaveCount(2)\n", ''))
  }, /Assertion minimum: DASH-003/) },
  { id: 'R5', title: 'canary attribution failure detected', run: async ({ root }) => {
    const inventory = JSON.parse(await readFile(join(root, 'tests/expected-tests.json'), 'utf8'))
    const entry = inventory.projects.chromium.tests.find(item => item.id === 'DASH-003')
    const report = { errors: [], suites: [{ title: 'mixed-campaign.spec.ts', specs: [{ title: entry.titlePath[0], file: 'mixed-campaign.spec.ts', tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'unexpected', results: [{ status: 'failed', retry: 0, errors: [{ message: 'Insufficient evidence' }], steps: [{ title: 'wrong-step', error: { message: 'synthetic' } }] }] }] }] }] }
    assert.throws(() => validateCanaryExecution(report, entry, true), /Only designated assertion step/)
  } },
  { id: 'R6', title: 'skip and focused-test operations rejected', run: async ({ root }) => {
    const original = await originalSpec(root)
    rejects(original.replace('test(', 'test.skip('), /Unapproved call test\.skip/)
    rejects(original.replace('test(', 'test.only('), /Unapproved call test\.only/)
    rejects(original + '\nconst localTest = test\n', /API alias forbidden/)
  } },
  { id: 'R7', title: 'reviewed locator repair passes static checks', run: async ({ root, artifactDirectory }) => {
    const original = await originalSpec(root)
    const rows = checkOrdinarySource('tests/mixed-campaign.spec.ts', original)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].minExpects, 7)
    assert.match(original, /name: \/fixture-mixed\/i/)
    assert.match(original, /toHaveURL\(\/\\\?campaign=fixture-mixed\$\/\)/)
    assert.match(original, /DASH-003-REASON-01/)
    if (process.env.PW_STAGE === '3') return await runR7BrowserControl(root, artifactDirectory)
  } },
  { id: 'R8', title: 'retry increase rejected', run: async ({ root }) => {
    const [config, pkg, workflow] = await Promise.all([configSource(root), packageSource(root), workflowSource(root)])
    assert.throws(() => checkConfiguration(config.replace('retries: 0', 'retries: 2'), pkg, workflow), /Unsafe configuration retries/)
  } },
  { id: 'R9', title: 'production fixture import removal rejected', run: ({ root }) => rejectsScan(root, async root => {
    const path = specPath(root)
    await writeFile(path, (await readFile(path, 'utf8')).replace("import { expect, test } from './fixtures/dashboard'\n", ''))
  }, /Exactly one production fixture import/) },
  { id: 'R10', title: 'mandatory verification workflow removal rejected', run: async ({ root }) => {
    const [config, pkg, workflow] = await Promise.all([configSource(root), packageSource(root), workflowSource(root)])
    assert.throws(() => checkConfiguration(config, pkg, workflow.replace('node harness/run_pr_verification.mjs', 'node harness/removed.mjs')), /Missing workflow command/)
    await rejectsScopeEdit('workflow')
  } },
  { id: 'R11', title: 'hygiene checker replacement rejected before execution', run: () => rejectsScopeEdit('checker') },
  { id: 'R13', title: 'unapproved title rejected', run: ({ root }) => rejectsScan(root, async root => {
    const path = specPath(root)
    await writeFile(path, (await readFile(path, 'utf8')).replace('mixed campaign displays BLOCKED', 'renamed campaign displays BLOCKED'))
  }, /Unknown\/missing test identity/) },
]

export async function validateR7CumulativeEvidence() {
  if (process.env.PW_STAGE !== '3') return { result: 'STATIC CONTROL ONLY', canary: 'NOT RUN BY STANDALONE MATRIX TEST' }
  const canaryPath = '/evidence/canary/summary.json'
  const canary = JSON.parse(await readFile(canaryPath, 'utf8'))
  assert.equal(canary.result, 'PASS')
  assert.equal(canary.classification, 'KILLED')
  assert.equal(canary.cleanup?.processes, 'PASS')
  assert.equal(canary.cleanup?.temporary_copies, 'PASS')
  return { result: 'PASS', canary: 'KILLED', evidence: 'canary/summary.json' }
}

export function pendingRemoteCases() {
  return [
    { id: 'R12', status: 'NOT RUN', reason: 'separate authorization and disposable remote target required' },
    { id: 'R14', status: 'NOT RUN', reason: 'separate authorization and disposable remote target required' },
  ]
}
