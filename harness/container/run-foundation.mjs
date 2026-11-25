import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { probe } from './isolation-probe.mjs'

const cwd = '/opt/qualityops/frontend'
const records = []
const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: '/tmp/qualityops-home', TMPDIR: '/tmp', CI: '1', PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
  PW_OUTPUT_DIR: '/evidence/e2e/test-results', PLAYWRIGHT_HTML_OPEN: 'never',
  PW_VERIFIER_REVISION: process.env.PW_VERIFIER_REVISION ?? '',
  PW_CANDIDATE_REVISION: process.env.PW_CANDIDATE_REVISION ?? '',
  PW_STAGE: process.env.PW_STAGE ?? '' }
const requireFrontend = createRequire(`${cwd}/package.json`)
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
function command(name, argv, options = {}) {
  return new Promise(resolve => {
    const started = Date.now(), child = spawn(argv[0], argv.slice(1), {
      cwd, env: { ...env, ...options.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', timedOut = false, oversized = false
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
    const timer = setTimeout(() => { timedOut = true; kill() }, 300_000)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      if (Buffer.byteLength(output) + bytes.length > 2 * 1024 * 1024) { oversized = true; kill() }
      else output += bytes.toString()
    })
    child.on('error', () => { output = 'child could not start' })
    child.on('close', (code, signal) => {
      clearTimeout(timer); kill() // Remove fixture-server descendants even after a normal child exit.
      const result = { name, command: argv, cwd, exit_code: code, signal, timeout: timedOut,
        environment: { ...env, ...options.env },
        output_limit: oversized, duration_ms: Date.now() - started,
        result: code === 0 && !timedOut && !oversized ? 'PASS' : 'FAIL' }
      if (options.stdout) fs.writeFileSync(options.stdout, output)
      else fs.writeFileSync(`/evidence/${name}.log`, output)
      records.push(result); write('/evidence/commands.json', records); resolve(result.result === 'PASS')
    })
  })
}

let result = 'BLOCKED'
let stage = 0
try {
  fs.mkdirSync(env.HOME, { recursive: true })
  write('/evidence/isolation.json', await probe())
  const policy = JSON.parse(fs.readFileSync('/opt/qualityops/runner/runtime-policy.json'))
  stage = Number(env.PW_STAGE)
  if (!Number.isInteger(stage) || !policy.implemented_stages.includes(stage))
    throw new Error('requested stage is not implemented')
  if (Number(process.versions.node.split('.')[0]) !== policy.node_major ||
      requireFrontend('@playwright/test/package.json').version !== policy.playwright)
    throw new Error('runtime/package version mismatch')
  const { chromium } = requireFrontend('playwright')
  const browser = await chromium.launch({ chromiumSandbox: true })
  const chromiumVersion = browser.version(); await browser.close()
  if (chromiumVersion !== policy.chromium) throw new Error('Chromium version mismatch')
  write('/evidence/versions.json', { node: process.version, playwright: policy.playwright, chromium: chromiumVersion })
  fs.mkdirSync('/evidence/e2e', { recursive: true })
  const steps = [
    ['probe', ['node', 'scripts/probe_webmcp.mjs', '--output', '/evidence/probe.json']],
    ['typecheck', ['npm', 'run', 'typecheck']],
    ['discovery', ['node', 'node_modules/@playwright/test/cli.js', 'test', '--project=chromium', '--list', '--reporter=json'],
      { stdout: '/evidence/e2e/discovery.json' }],
    ['e2e', ['node', 'node_modules/@playwright/test/cli.js', 'test', '--project=chromium', '--reporter=json'],
      { env: { PLAYWRIGHT_JSON_OUTPUT_FILE: '/evidence/e2e/report.json' } }],
    ['guard', ['node', 'scripts/test_guard_fixture.mjs', '--report', '/evidence/guard/report.json']],
    ['lifecycle', ['node', 'scripts/test_webmcp_lifecycle.mjs', '--report', '/evidence/lifecycle/report.json']],
  ]
  if (stage >= 2) steps.push(
    ['hygiene-unit', ['npm', 'run', 'test:hygiene']],
    ['hygiene-chromium', ['npm', 'run', 'check:hygiene', '--', '--project=chromium', '--report', '/evidence/e2e/report.json'],
      { env: { PW_HYGIENE_OUTPUT_DIR: '/evidence/hygiene/chromium' } }],
    ['hygiene-chromium-guard-meta', ['npm', 'run', 'check:hygiene', '--', '--project=chromium-guard-meta', '--report', '/evidence/guard/report.json'],
      { env: { PW_HYGIENE_OUTPUT_DIR: '/evidence/hygiene/chromium-guard-meta' } }],
    ['hygiene-chromium-webmcp-lifecycle', ['npm', 'run', 'check:hygiene', '--', '--project=chromium-webmcp-lifecycle', '--report', '/evidence/lifecycle/report.json'],
      { env: { PW_HYGIENE_OUTPUT_DIR: '/evidence/hygiene/chromium-webmcp-lifecycle' } }],
    ['canary', ['npm', 'run', 'test:canary'], { env: { PW_CANARY_OUTPUT_DIR: '/evidence/canary' } }],
  )
  if (stage >= 3) steps.push(
    ['red-team', ['node', '/opt/qualityops/harness/verify_red_team_matrix.mjs', '--local', '--output', '/evidence/red-team']],
    ['ci-workflow', ['node', '/opt/qualityops/harness/check_ci_workflow.mjs']],
    ['red-team-unit', ['node', '--test', '/opt/qualityops/harness/test_red_team_matrix.mjs']],
    ['ci-workflow-unit', ['node', '--test', '/opt/qualityops/harness/test_ci_workflow.mjs']],
    ['r7-variant-unit', ['node', '--test', '/opt/qualityops/harness/test_r7_variant.mjs']],
  )
  result = 'PASS'
  for (const [name, argv, options] of steps) {
    if (!await command(name, argv, options)) { result = 'FAIL'; break }
  }
} catch (error) {
  write('/evidence/blocker.json', { result: 'BLOCKED', reason: error.message })
} finally {
  write('/evidence/foundation.json', { result, commands: records,
    limitations: ['Bootstrap evidence requires independent review and SHA-bound human acceptance.',
      ...(stage < 2 ? ['Stage 2 hygiene/canary, Stage 3 offline CI/red-team and Stage 4 summaries are not run in this stage.']
        : stage < 3 ? ['Stage 3 offline CI/red-team and Stage 4 summaries are not run in this stage.']
          : ['Stage 3 offline Python suites run on the trusted host; Stage 4 summaries are not implemented.'])] })
}
process.exitCode = result === 'PASS' ? 0 : 1
