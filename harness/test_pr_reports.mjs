import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateReport, readJson } from './check_pr_reports.mjs'

const project = 'chromium'
const policy = { projects: { [project]: [{ id: 'DASH-003', file: 'tests/mixed.spec.ts', titles: ['mixed'] }] } }
function report() { return { errors: [], suites: [{ title: 'mixed.spec.ts', file: 'mixed.spec.ts', specs: [{
  title: 'mixed', file: 'mixed.spec.ts', tests: [{ projectName: project, expectedStatus: 'passed', status: 'expected',
    results: [{ retry: 0, status: 'passed', errors: [], attachments: [{ name: 'guard-diagnostics', contentType: 'application/json', body: Buffer.from('{"codes":[]}').toString('base64') }] }] }],
}] }] } }
const row = value => value.suites[0].specs[0].tests[0]

test('single reviewed passing identity and discovery are accepted separately', () => {
  assert.equal(validateReport(report(), project, policy).result, 'PASS')
  const discovery = report(); row(discovery).results = []
  assert.equal(validateReport(discovery, project, policy, { discovery: true }).count, 1)
  assert.throws(() => validateReport(discovery, project, policy), /exactly once/)
})
for (const [name, mutate] of [
  ['missing execution', value => { value.suites = [] }],
  ['extra execution', value => value.suites.push(structuredClone(value.suites[0]))],
  ['changed title', value => { value.suites[0].specs[0].title = 'weakened' }],
  ['wrong project', value => { row(value).projectName = 'other' }],
  ['skipped', value => { row(value).expectedStatus = 'skipped' }],
  ['retried', value => row(value).results.push(structuredClone(row(value).results[0]))],
  ['retry counter', value => { row(value).results[0].retry = 1 }],
  ['timeout', value => { row(value).results[0].status = 'timedOut' }],
  ['fatal runner error', value => value.errors.push({ message: 'runner crash' })],
]) test(`rejects ${name}`, () => {
  const value = report(); mutate(value)
  assert.throws(() => validateReport(value, project, policy))
})
test('guard requires real teardown attribution, never just nonzero exit', () => {
  const guardPolicy = structuredClone(policy); guardPolicy.projects[project][0].guard_reason = 'HTTP_404'
  const value = report(), execution = row(value)
  execution.status = 'unexpected'; execution.results[0].status = 'failed'
  execution.results[0].attachments[0].body = Buffer.from('{"codes":["HTTP_404","CONSOLE_ERROR"]}').toString('base64')
  execution.results[0].errors = [{ message: 'DASHBOARD_GUARD HTTP_404,CONSOLE_ERROR' }]
  assert.equal(validateReport(value, project, guardPolicy).result, 'PASS')
  for (const message of ['DASHBOARD_GUARD HTTP_500', 'unrelated assertion', '']) {
    execution.results[0].errors = [{ message }]
    assert.throws(() => validateReport(value, project, guardPolicy))
  }
  execution.results[0].errors = []
  assert.throws(() => validateReport(value, project, guardPolicy))
})
test('unimplemented project and duplicate policy identities fail closed', () => {
  assert.throws(() => validateReport(report(), 'chromium-webmcp', policy))
  const duplicate = structuredClone(policy); duplicate.projects[project].push(duplicate.projects[project][0])
  assert.throws(() => validateReport(report(), project, duplicate))
})
test('missing and symlink report are rejected', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'))
  try {
    assert.throws(() => readJson(path.join(tmp, 'absent')))
    fs.writeFileSync(path.join(tmp, 'report'), '{}')
    fs.symlinkSync('report', path.join(tmp, 'link'))
    assert.throws(() => readJson(path.join(tmp, 'link')))
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
