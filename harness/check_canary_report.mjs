import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { executions } from './check_pr_reports.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function commitBlob(revision, file) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('full immutable revision required')
  const resolved = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim()
  if (resolved !== revision) throw new Error('revision mismatch')
  return execFileSync('git', ['show', `${revision}:${file}`], { cwd: repo, maxBuffer: 8 * 1024 * 1024 })
}
function safeJson(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => !x || x === '.' || x === '..'))
    throw new Error('artifact path must be relative and traversal-free')
  const file = path.join(root, relative), resolved = path.resolve(file)
  if (!resolved.startsWith(root + path.sep)) throw new Error('artifact path escapes root')
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('artifact must be bounded regular JSON')
  return { file, bytes: fs.readFileSync(file), value: JSON.parse(fs.readFileSync(file, 'utf8')) }
}
function exactCanaryReport(report, expected, expectedStatus) {
  if (!Array.isArray(report.errors) || report.errors.length) throw new Error('canary runner errors present')
  const rows = executions(report)
  if (rows.length !== 1) throw new Error('canary report must contain exactly one execution')
  const row = rows[0]
  if (row.project !== expected.project || row.file !== expected.file || !equal(row.titles, expected.titles))
    throw new Error('canary identity mismatch')
  const test = row.test
  if (test.expectedStatus !== 'passed') throw new Error('canary must expect a passing result')
  if (expectedStatus === 'discovery') {
    if ((test.results || []).length) throw new Error('discovery report must not contain executions')
    return row
  }
  if (test.results?.length !== 1) throw new Error('canary must execute exactly once')
  const result = test.results[0]
  if (result.retry !== 0 || result.status !== expectedStatus || test.status !== (expectedStatus === 'passed' ? 'expected' : 'unexpected'))
    throw new Error('canary status or retry mismatch')
  if (expectedStatus === 'passed') {
    if (result.errors?.length) throw new Error('positive canary contains errors')
  } else {
    const failed = []
    const visit = steps => { for (const step of steps || []) {
      if (step.title === expected.step_id && step.error) failed.push(step)
      visit(step.steps)
    } }
    visit(result.steps)
    if (failed.length !== 1 || !result.errors?.length) throw new Error('mutant must fail exactly at the reviewed step')
    if (result.errors.some(error => !String(error.message || '').includes('Insufficient evidence')))
      throw new Error('mutated failure is not the missing-evidence assertion')
  }
  return row
}

export function validateCanary({ root, summaryPath, verifierRevision, candidateRevision, policy }) {
  root = path.resolve(root)
  const canaryRoot = path.resolve(path.dirname(summaryPath))
  if (canaryRoot !== path.join(root, 'canary') || path.basename(summaryPath) !== 'summary.json')
    throw new Error('canary summary must be the collected canary/summary.json artifact')
  const { value: summary } = safeJson(canaryRoot, 'summary.json')
  const expected = policy.canary
  if (!expected || summary.schema_version !== 'canary-1' || summary.result !== 'PASS' || summary.classification !== 'KILLED')
    throw new Error('canary did not produce a successful killed classification')
  const requirement = summary.requirement
  if (!requirement || requirement.id !== expected.id || requirement.project !== expected.project ||
      requirement.file !== expected.file || !equal(requirement.titlePath, expected.titles) || requirement.stepId !== expected.step_id)
    throw new Error('canary requirement differs from trusted policy')
  const inputs = summary.inputs || {}
  if (inputs.source_revision !== verifierRevision || inputs.inventory_sha256 !== sha(commitBlob(verifierRevision, 'frontend/tests/expected-tests.json')) ||
      inputs.lockfile_sha256 !== sha(commitBlob(verifierRevision, 'frontend/package-lock.json')) ||
      inputs.spec_sha256 !== sha(commitBlob(candidateRevision, `frontend/${expected.file}`)))
    throw new Error('canary inputs do not match immutable verifier/candidate blobs')

  const original = JSON.parse(commitBlob(verifierRevision, expected.export_path).toString('utf8'))
  const originalBytes = commitBlob(verifierRevision, expected.export_path)
  const mutatedArtifact = safeJson(canaryRoot, summary.mutation?.snapshot)
  const mutated = mutatedArtifact.value
  const target = original.campaigns?.find(c => c.id === expected.campaign_id)
  if (!target) throw new Error('trusted mutation campaign missing')
  const reasons = target.gate?.reasons
  const removed = reasons?.filter(reason => reason.code === expected.reason_code) || []
  if (removed.length !== 1 || summary.mutation.removed_count !== 1 || !summary.mutation.exact_delta ||
      !equal(summary.mutation.removed_reason, removed[0])) throw new Error('mutation is not the exact one-reason removal')
  const expectedMutated = structuredClone(original)
  const campaign = expectedMutated.campaigns.find(c => c.id === expected.campaign_id)
  campaign.gate.reasons = campaign.gate.reasons.filter(reason => reason.code !== expected.reason_code)
  if (!equal(mutated, expectedMutated) || mutatedArtifact.bytes.length > 2 * 1024 * 1024)
    throw new Error('mutated export differs beyond the approved single reason')
  const originalDigest = sha(originalBytes), mutatedDigest = sha(mutatedArtifact.bytes)
  if (summary.mutation.original_export_sha256 !== originalDigest ||
      summary.mutation.mutated_export_sha256 !== mutatedDigest || summary.mutation.removed_reason.code !== expected.reason_code)
    throw new Error('mutation digest mismatch')

  for (const [name, codes] of [['positive', expected.preserved_reason_codes], ['mutated', [expected.preserved_reason_codes[0]]]]) {
    const variant = summary.variants?.[name]
    if (!variant || variant.project !== expected.project || variant.export_sha256 !== (name === 'positive' ? originalDigest : mutatedDigest))
      throw new Error(`${name} variant input mismatch`)
    const precheck = variant.precheck
    const expectedReasons = name === 'positive'
      ? [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }, { code: 'INSUFFICIENT_EVIDENCE', execution_id: 'y' }]
      : [{ code: 'REQUIRED_FAILURE', execution_id: 'x' }]
    if (precheck?.decision !== 'BLOCKED' || precheck.reason_count !== codes.length ||
        !equal(precheck.reasons, expectedReasons) || !equal(expectedReasons.map(x => x.code).sort(), [...codes].sort()))
      throw new Error(`${name} served UI precheck differs from trusted expected reasons`)
    const discoveryArtifact = safeJson(canaryRoot, variant.discovery)
    const executionArtifact = safeJson(canaryRoot, variant.report)
    if (variant.discovery_sha256 !== sha(discoveryArtifact.bytes) || variant.report_sha256 !== sha(executionArtifact.bytes))
      throw new Error(`${name} report digest mismatch`)
    const discovery = discoveryArtifact.value, execution = executionArtifact.value
    exactCanaryReport(discovery, expected, 'discovery')
    exactCanaryReport(execution, expected, name === 'positive' ? 'passed' : 'failed')
    if (variant.discovery_exit_code !== 0 || variant.execution_exit_code !== (name === 'positive' ? 0 : 1) ||
        variant.execution_status !== (name === 'positive' ? 'passed' : 'failed'))
      throw new Error(`${name} command status mismatch`)
    const executionRow = executions(execution)[0]
    const resultRow = executionRow.test.results[0]
    const failedSteps = []
    const visit = steps => { for (const step of steps || []) { if (step.error) failedSteps.push(step.title); visit(step.steps) } }
    visit(resultRow.steps)
    if (!equal(variant.failed_steps, failedSteps) ||
        !equal(failedSteps, name === 'positive' ? [] : [expected.step_id]))
      throw new Error(`${name} failed-step summary mismatch`)
    const hashes = variant.bundle_sha256
    if (!hashes || !Object.keys(hashes).length || Object.values(hashes).some(x => !/^[0-9a-f]{64}$/.test(x)))
      throw new Error(`${name} bundle digest set missing or invalid`)
  }
  if (equal(summary.variants.positive.bundle_sha256, summary.variants.mutated.bundle_sha256))
    throw new Error('canary bundle did not change after mutation')
  if (summary.cleanup?.processes !== 'PASS' || summary.cleanup?.temporary_copies !== 'PASS')
    throw new Error('canary cleanup not proven')
  return { result: 'PASS', classification: 'KILLED', id: expected.id }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
    if (!args.includes('--summary') || !args.includes('--root') || !args.includes('--verifier-revision') || !args.includes('--candidate-revision'))
      throw new Error('--summary, --root, --verifier-revision and --candidate-revision required')
    const policy = JSON.parse(fs.readFileSync(path.join(repo, 'harness/pr-verification-policy.json')))
    const result = validateCanary({ root: path.resolve(option('--root')), summaryPath: path.resolve(option('--summary')),
      verifierRevision: option('--verifier-revision'), candidateRevision: option('--candidate-revision'), policy })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}
