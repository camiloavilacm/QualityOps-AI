import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import assert from 'node:assert/strict'

export async function run(command, env, timeout = 300_000) {
  return await new Promise(resolve => {
    const child = spawn(process.execPath, command, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let output = '', timedOut = false
    const collect = chunk => { if (output.length < 64_000) output += chunk.toString().slice(0, 64_000 - output.length) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, timeout)
    child.once('error', () => { clearTimeout(timer); resolve({ command, exit_code: null, timedOut, output: 'Child startup failed' }) })
    child.once('close', code => { clearTimeout(timer); resolve({ command, exit_code: code, timedOut, output }) })
  })
}
export function tests(report) {
  const rows = []
  function visit(suites, prefix = []) {
    for (const suite of suites ?? []) {
      const path = suite.title ? [...prefix, suite.title] : prefix
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) rows.push({ title: spec.title, file: spec.file, titlePath: [...path, spec.title], ...test })
      visit(suite.suites, path)
    }
  }
  visit(report.suites)
  return rows
}
export async function save(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n') }
export async function validate(path, project, expected, discovery = false) {
  const report = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(report.errors ?? [], [], 'Runner fatal errors')
  const rows = tests(report)
  const file = project === 'chromium-guard-meta' ? 'meta/guard-verification.spec.ts' : 'meta/webmcp-lifecycle.spec.ts'
  assert.equal(rows.length, Object.keys(expected).length, 'Exact execution count')
  assert.equal(new Set(rows.map(row => row.title)).size, rows.length, 'Duplicate title')
  for (const row of rows) {
    assert.equal(row.projectName, project)
    assert.equal(row.file, file)
    assert.deepEqual(row.titlePath, [file, row.title])
    assert.ok(Object.hasOwn(expected, row.title), `Unknown title ${row.title}`)
    if (discovery) continue
    assert.equal(row.expectedStatus, 'passed')
    assert.equal(row.results.length, 1, 'One attempt only')
    const result = row.results[0]
    assert.equal(result.retry, 0)
    const code = expected[row.title]
    assert.equal(row.status, code ? 'unexpected' : 'expected')
    assert.equal(result.status, code ? 'failed' : 'passed')
    const diagnostics = (result.attachments ?? []).find(item => item.name === 'guard-diagnostics')
    assert.ok(diagnostics, 'Production guard attachment required')
    const bytes = diagnostics.body ? Buffer.from(diagnostics.body, 'base64') : await readFile(diagnostics.path)
    const codes = JSON.parse(bytes).codes
    if (code) {
      assert.ok(codes.includes(code), `Expected guard ${code}`)
      const allowed = new Set([code, ...(['HTTP_404', 'HTTP_500', 'REQUEST_FAILED'].includes(code) ? ['CONSOLE_ERROR'] : [])])
      assert.ok(codes.every(item => allowed.has(item)), 'Unrelated guard failures')
      assert.ok(result.errors?.length)
      assert.ok(result.errors.every(error => error.message?.includes('DASHBOARD_GUARD')), 'Only guard-attributed errors accepted')
    } else assert.deepEqual(codes, [])
  }
  return rows.map(({ title, file, titlePath, projectName, status }) => ({ title, file, titlePath, projectName, status }))
}
