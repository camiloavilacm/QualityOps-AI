import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkConfiguration, checkOrdinarySource, scanTree } from '../frontend/scripts/check_test_hygiene.mjs'
import { validateCanaryExecution } from '../frontend/scripts/check_canary_regression.mjs'

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
  { id: 'R7', title: 'reviewed locator repair passes static checks', run: async ({ root }) => {
    const original = await originalSpec(root)
    const rows = checkOrdinarySource('tests/mixed-campaign.spec.ts', original)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].minExpects, 7)
    assert.match(original, /name: \/fixture-mixed\/i/)
    assert.match(original, /toHaveURL\(\/\\\?campaign=fixture-mixed\$\/\)/)
    assert.match(original, /DASH-003-REASON-01/)
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
