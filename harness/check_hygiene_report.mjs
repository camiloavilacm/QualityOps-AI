import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { validateReport, readJson } from './check_pr_reports.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const ordinarySpecs = new Set(['tests/seed.spec.ts', 'tests/mixed-campaign.spec.ts', 'tests/dashboard-flows.spec.ts'])
function blob(revision, file) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('full immutable revision required')
  const resolved = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim()
  if (resolved !== revision) throw new Error('revision mismatch')
  return execFileSync('git', ['show', `${revision}:${file}`], { cwd: repo, maxBuffer: 8 * 1024 * 1024 })
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => !x || x === '.' || x === '..'))
    throw new Error('report artifact path must be relative')
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep)) throw new Error('report path escape')
  return file
}
function load(root, relative) {
  const file = safePath(root, relative), stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('missing or unsafe report')
  return { file, bytes: fs.readFileSync(file), value: readJson(file) }
}
function expectedInventory(policy) {
  const rows = {}
  for (const [project, entries] of Object.entries(policy.projects)) {
    rows[project] = { state: 'active', status: 'INTRODUCED', count: entries.length,
      tests: entries.map(row => ({ project, id: row.id, file: row.file, titlePath: row.titles,
        minExpects: row.min_expects, ...(row.guard_reason ? { guardReason: row.guard_reason } : {}),
        ...(row.step_id ? { stepId: row.step_id } : {}) })) }
  }
  for (const [project, pending] of Object.entries(policy.pending_projects || {})) {
    rows[project] = { state: 'pending-stage4', status: pending.status, count: pending.count, tests: [] }
  }
  return rows
}

export function sourceRevisionFor(project, file, verifierRevision, candidateRevision) {
  if (!['chromium', 'chromium-guard-meta', 'chromium-webmcp-lifecycle', 'chromium-webmcp'].includes(project))
    throw new Error('source hash requested for a non-active project')
  return ordinarySpecs.has(file) ? candidateRevision : verifierRevision
}

export function validateHygiene({ root, project, verifierRevision, candidateRevision, policy }) {
  root = path.resolve(root)
  const allowedProjects = Object.keys(policy.projects)
  if (!allowedProjects.includes(project)) throw new Error('project is not an active trusted contract')
  const invPath = 'frontend/tests/expected-tests.json'
  const inventoryBytes = blob(verifierRevision, invPath), inventory = JSON.parse(inventoryBytes.toString('utf8'))
  const normalizedProjects = Object.fromEntries(Object.entries(inventory.projects || {}).map(([key, value]) =>
    [key, { state: value.state, status: value.status, count: value.count, tests: value.tests }]))
  if (!isDeepStrictEqual(normalizedProjects, expectedInventory(policy)))
    throw new Error('candidate inventory does not equal trusted identities/minima')
  const policyBytes = blob(verifierRevision, 'harness/pr-verification-policy.json')
  const record = load(root, `hygiene/${project}/${project}-hygiene.json`).value
  if (record.schema_version !== 'hygiene-1' || record.result !== 'PASS' || record.project !== project ||
      record.verifier_revision !== verifierRevision || record.source_bytes !== 'observed-candidate')
    throw new Error('hygiene record incomplete or not bound to verifier/candidate source')
  if (record.inventory_sha256 !== digest(inventoryBytes) || record.policy_sha256 !== digest(policyBytes))
    throw new Error('hygiene trust input digest mismatch')
  const projectContract = inventory.projects[project]
  if (projectContract?.state !== 'active' || projectContract.status !== 'INTRODUCED' ||
      projectContract.discovery?.zeroDiscoveryOnly !== false ||
      !/^[0-9a-f]{64}$/.test(projectContract.discovery?.sha256 || ''))
    throw new Error('active project has no positive discovery contract')
  const expectedFiles = new Set([
    'tests/expected-tests.json',
    ...new Set(Object.values(inventory.projects).flatMap(contract => contract.tests.map(entry => entry.file))),
    ...Object.keys(inventory.protectedSources),
    ...inventory.helperFiles,
  ])
  if (!Array.isArray(record.files) || JSON.stringify(record.files) !== JSON.stringify([...expectedFiles].sort()))
    throw new Error('recursive test file inventory mismatch')
  const hashes = record.source_sha256
  if (!hashes || JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify([...expectedFiles].sort()))
    throw new Error('observed source digest set mismatch')
  for (const file of expectedFiles) {
    const repositoryPath = `frontend/${file}`
    const sourceRevision = sourceRevisionFor(project, file, verifierRevision, candidateRevision)
    if (hashes[file] !== digest(blob(sourceRevision, repositoryPath))) throw new Error(`observed source digest mismatch: ${file}`)
  }
  const discovery = load(root, `hygiene/${project}/${record.discovery}`)
  if (record.discovery_sha256 !== digest(discovery.bytes)) throw new Error('discovery report digest mismatch')
  const discoveryResult = validateReport(discovery.value, project, policy, { discovery: true })
  if (record.discovered !== discoveryResult.count) throw new Error('hygiene discovery count mismatch')
  if (record.child?.exit_code !== 0 || record.child?.timedOut || !Array.isArray(record.command) ||
      record.command.some(value => /(?:^|\/)npx(?:$|\s)|npm\s+(?:install|ci)/.test(String(value))))
    throw new Error('hygiene discovery command was not bounded/installed-local')
  if (!record.execution || !record.execution_sha256) throw new Error('execution report missing')
  const execution = load(root, `hygiene/${project}/${record.execution}`)
  if (record.execution_sha256 !== digest(execution.bytes)) throw new Error('execution report digest mismatch')
  const executionResult = validateReport(execution.value, project, policy)
  if (record.executed !== executionResult.count) throw new Error('hygiene execution count mismatch')
  return { result: 'PASS', project, discovered: record.discovered, executed: record.executed }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
    for (const required of ['--root', '--project', '--verifier-revision', '--candidate-revision'])
      if (!args.includes(required)) throw new Error(`${required} required`)
    const policy = JSON.parse(fs.readFileSync(path.join(repo, 'harness/pr-verification-policy.json')))
    console.log(JSON.stringify(validateHygiene({ root: path.resolve(option('--root')), project: option('--project'),
      verifierRevision: option('--verifier-revision'), candidateRevision: option('--candidate-revision'), policy }), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}
