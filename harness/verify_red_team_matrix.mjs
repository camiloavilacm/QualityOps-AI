import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, lstat, writeFile, copyFile, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaseWorkspace, localCases, pendingRemoteCases, removeCaseWorkspace, validateR7CumulativeEvidence } from './red_team_cases.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = data => createHash('sha256').update(data).digest('hex')

function revision() {
  const supplied = process.env.PW_VERIFIER_REVISION
  const candidate = process.env.PW_CANDIDATE_REVISION
  if (supplied && candidate) {
    assert.match(supplied, /^[0-9a-f]{40}$/)
    assert.equal(candidate, supplied, 'offline matrix requires identical trusted and candidate revisions')
    return supplied
  }
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repo, encoding: 'utf8' })
  assert.equal(result.status, 0, 'immutable source revision unavailable')
  return result.stdout.trim()
}

function parse(args) {
  assert.deepEqual(args.slice(0, 1), ['--local'], 'Only local mode is supported')
  assert.equal(args[1], '--output', '--output <directory> is required')
  assert.equal(args.length, 3, 'Unexpected arguments')
  const requested = resolve(args[2])
  return requested
}

async function main() {
  const output = parse(process.argv.slice(2))
  const artifactsRoot = resolve(repo, 'harness/artifacts')
  assert.ok(output.startsWith(artifactsRoot + '/') || !output.startsWith(repo + '/'),
    'red-team output must be outside source files or beneath harness/artifacts')
  await mkdir(dirname(output), { recursive: true })
  const parent = await lstat(dirname(output))
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink(), 'output parent must be a real directory')
  try { await lstat(output); throw new Error('output must be a new path') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(output)
  const candidate = revision()
  const policyBytes = await readFile(joinPath('harness/pr-verification-policy.json'))
  const stagedArtifacts = resolve(output, 'staged-r7')
  await mkdir(stagedArtifacts)
  const records = []
  for (const scenario of localCases) {
    const row = { id: scenario.id, scenario: scenario.title, status: 'FAIL', workspace_cleanup: 'NOT RUN' }
    let isolated
    try {
      isolated = await createCaseWorkspace()
      const artifactDirectory = scenario.id === 'R7' ? resolve(stagedArtifacts, 'R7') : undefined
      if (artifactDirectory) await mkdir(artifactDirectory)
      const detail = await scenario.run({ ...isolated, artifactDirectory })
      if (detail) row.browser_control = detail
      row.status = 'PASS'
    } catch (error) {
      row.reason = 'expected trusted component outcome was not observed'
      if (scenario.id === 'R7' && Array.isArray(error?.evidence))
        row.browser_control_evidence = error.evidence.filter(name =>
          ['baseline-failure.json', 'baseline-trace.zip', 'renamed_control-failure.json', 'renamed_control-trace.zip'].includes(name))
          .map(name => `R7/${name}`)
    } finally {
      if (isolated) {
        try { await removeCaseWorkspace(isolated.temp); row.workspace_cleanup = 'PASS' }
        catch { row.workspace_cleanup = 'FAIL'; row.status = 'FAIL'; row.reason = 'disposable case workspace cleanup failed' }
      }
    }
    records.push(row)
  }
  const r7 = records.find(row => row.id === 'R7')
  try {
    r7.cumulative_control = await validateR7CumulativeEvidence()
    if (process.env.PW_STAGE === '3') r7.artifact = 'container/canary/summary.json'
    else {
      r7.component_status = 'PASS'
      r7.status = 'NOT RUN'
      r7.reason = 'R7 browser and cumulative canary controls require Stage 3 container execution'
    }
  } catch {
    r7.status = 'FAIL'
    r7.reason = 'cumulative canary control did not pass with KILLED classification'
  }
  const report = {
    schema_version: 'red-team-matrix-1',
    result: records.length === 13 && records.every(row => row.status === 'PASS') && process.env.PW_STAGE === '3'
      ? 'PASS' : records.every(row => ['PASS', 'NOT RUN'].includes(row.status)) ? 'INCOMPLETE' : 'FAIL',
    verifier_revision: candidate,
    candidate_revision: candidate,
    source_policy_sha256: digest(policyBytes),
    local_scenarios: records,
    remote_scenarios: pendingRemoteCases(),
    limitations: ['Component mutation probes exercise trusted validators; they do not execute an untrusted candidate overlay.',
      ...(process.env.PW_STAGE === '3' ? [] : ['Standalone matrix tests do not assert a container canary result.']),
      'R12/R14 require separate authorization and disposable remote enforcement evidence.'],
  }
  const publication = resolve(output, 'publication')
  await mkdir(publication)
  const cases = resolve(publication, 'cases')
  await mkdir(cases)
  const r7Cases = resolve(cases, 'R7')
  await mkdir(r7Cases)
  const stagedR7 = resolve(stagedArtifacts, 'R7')
  try {
    for (const name of await readdir(stagedR7)) {
      if (!/^(baseline|renamed_control)-(?:report|failure)[.]json$|^(baseline|renamed_control)-trace[.]zip$/.test(name))
        throw new Error('unexpected R7 artifact')
      await copyFile(resolve(stagedR7, name), resolve(r7Cases, name), 0)
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await rm(stagedArtifacts, { recursive: true, force: true })
  for (const row of records)
    await writeFile(resolve(cases, `${row.id}.json`), JSON.stringify(row, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const payload = JSON.stringify(report, null, 2) + '\n'
  await writeFile(resolve(publication, 'red-team-summary.json'), payload, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ result: report.result, local: records.map(({ id, status }) => ({ id, status })), remote: report.remote_scenarios }))
  return report.result === 'PASS' ? 0 : 1
}

function joinPath(...parts) { return resolve(repo, ...parts) }

main().then(code => { process.exitCode = code }).catch(() => {
  console.error(JSON.stringify({ result: 'BLOCKED', reason: 'invalid invocation or output path' }))
  process.exitCode = 2
})
