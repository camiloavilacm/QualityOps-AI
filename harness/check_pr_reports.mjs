import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export function readJson(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new Error('report must be a bounded regular JSON file')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function executions(report) {
  const rows = []
  function visit(suites, titles = [], file = '') {
    for (const suite of suites) {
      const nextFile = suite.file || file
      // Playwright's root file suite title is presentation, not a describe title.
      const nextTitles = suite.file && !file ? titles : [...titles, suite.title]
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) rows.push({
          file: 'tests/' + (spec.file || nextFile).replaceAll('\\', '/').replace(/^.*\/tests\//, '').replace(/^tests\//, ''),
          titles: [...nextTitles, spec.title], project: test.projectName, test,
        })
      }
      visit(suite.suites || [], nextTitles, nextFile)
    }
  }
  if (!Array.isArray(report.suites)) throw new Error('missing suites')
  visit(report.suites)
  return rows
}

export function validateReport(report, project, policy, { discovery = false } = {}) {
  const expected = policy.projects[project]
  if (!Array.isArray(expected) || !expected.length) throw new Error('unimplemented or empty project contract')
  if (!Array.isArray(report.errors) || report.errors.length) throw new Error('missing errors array or fatal runner errors')
  const key = row => JSON.stringify([row.file, row.titles])
  const wanted = new Map(expected.map(row => [key(row), row]))
  if (wanted.size !== expected.length || new Set(expected.map(r => r.id)).size !== expected.length)
    throw new Error('duplicate trusted identities or stable IDs')
  const rows = executions(report)
  const seen = new Set()
  if (rows.length !== expected.length) throw new Error('incorrect execution count')
  for (const row of rows) {
    const identity = key(row), entry = wanted.get(identity), test = row.test
    if (row.project !== project || !entry || seen.has(identity)) throw new Error('unexpected or duplicate test identity')
    seen.add(identity)
    if (discovery) {
      if ((test.results || []).length) throw new Error('discovery contains executions')
      continue
    }
    if (test.expectedStatus !== 'passed' || test.results?.length !== 1)
      throw new Error('test must expect passing and run exactly once')
    const result = test.results[0]
    const negative = Boolean(entry.guard_reason)
    if (result.retry !== 0 || result.status !== (negative ? 'failed' : 'passed') ||
        test.status !== (negative ? 'unexpected' : 'expected')) throw new Error('incorrect result, retry, or outcome')
    const errors = result.errors || []
    const attachments = (result.attachments || []).filter(item => item.name === 'guard-diagnostics')
    if (attachments.length !== 1 || attachments[0].contentType !== 'application/json' ||
        !attachments[0].body || attachments[0].body.length > 8192) throw new Error('missing bounded inline guard diagnostics')
    const codes = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString()).codes
    if (!Array.isArray(codes) || codes.length > 33) throw new Error('invalid guard diagnostics')
    if (negative) {
      const allowed = [entry.guard_reason, ...(['HTTP_404', 'HTTP_500', 'REQUEST_FAILED'].includes(entry.guard_reason) ? ['CONSOLE_ERROR'] : [])]
      if (!codes.includes(entry.guard_reason) || codes.some(code => !allowed.includes(code)))
        throw new Error('incorrect guard diagnostic reason')
      // All errors must come from teardown of the real automatic guard.
      if (!errors.length || errors.some(error => !error.message?.includes('DASHBOARD_GUARD ') ||
          !error.message.includes(entry.guard_reason))) throw new Error('missing or unrelated guard attribution')
    } else if (errors.length || result.error || codes.length) throw new Error('passing test contains errors')
  }
  return { result: 'PASS', project, count: rows.length, discovery, ids: expected.map(row => row.id) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const option = name => args[args.indexOf(name) + 1]
    if (!args.includes('--project') || !args.includes('--report')) throw new Error('--project and --report required')
    const policy = readJson(path.join(here, 'pr-verification-policy.json'))
    console.log(JSON.stringify(validateReport(readJson(option('--report')), option('--project'), policy,
      { discovery: args.includes('--discovery') }), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}
