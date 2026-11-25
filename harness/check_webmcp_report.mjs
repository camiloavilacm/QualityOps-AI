import crypto from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { readJson, validateReport } from './check_pr_reports.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED_ORACLE_ID = 'qualityops-authored-evaluation-oracle-v1-do-not-bundle'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const requiredOracleSources = [
  'evaluators/test_evaluate.py',
  'evaluators/authored_examples.py',
  'evaluators/evaluate.py',
  'evaluators/model_visible/corpus-v1.json',
]

function gitBlob(revision, file) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('full verifier revision required')
  const resolved = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (resolved !== revision) throw new Error('verifier revision mismatch')
  return execFileSync('git', ['show', `${revision}:${file}`], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 })
}

function attachment(report, name, stableId) {
  const rows = []
  function visit(suites = []) {
    for (const suite of suites) {
      for (const spec of suite.specs || []) for (const test of spec.tests || [])
        for (const result of test.results || []) for (const item of result.attachments || [])
          if (item.name === name) rows.push({ item, title: spec.title })
      visit(suite.suites || [])
    }
  }
  visit(report.suites)
  if (rows.length !== 1) throw new Error(`expected exactly one ${name} attachment`)
  const { item, title } = rows[0]
  if (typeof title !== 'string' || !title.startsWith(`${stableId} `))
    throw new Error(`${name} attachment is not bound to ${stableId}`)
  if (item.contentType !== 'application/json' || typeof item.body !== 'string' || item.body.length > 350000)
    throw new Error(`invalid bounded ${name} attachment`)
  const bytes = Buffer.from(item.body, 'base64')
  if (bytes.length > 256 * 1024 || bytes.toString('base64') !== item.body)
    throw new Error(`invalid base64 or oversized ${name} attachment`)
  return JSON.parse(bytes.toString('utf8'))
}

function publicEnvelope(value) {
  if (!value || value.isError !== false || !Array.isArray(value.content) || value.content.length !== 1 ||
      value.content[0]?.type !== 'text' || typeof value.content[0]?.text !== 'string' ||
      value.content[0].text.length > 16384) throw new Error('invalid MCP result envelope')
  return JSON.parse(value.content[0].text)
}

function checkStatePair(row, label) {
  const { state_before: before, state_after: after } = row
  const keys = ['url', 'dom_sha256', 'local_storage_sha256', 'session_storage_sha256', 'recorded_state_sha256']
  if (!before || !after || !isDeepStrictEqual(Object.keys(before).sort(), [...keys].sort()) ||
      !isDeepStrictEqual(Object.keys(after).sort(), [...keys].sort()) || !isDeepStrictEqual(before, after))
    throw new Error(`${label} read-only state changed or has an unexpected shape`)
  if (typeof before.url !== 'string' || !/^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(before.url))
    throw new Error(`${label} state URL is outside the local fixture origin`)
  for (const key of keys.slice(1)) if (!/^[0-9a-f]{64}$/.test(before[key]))
    throw new Error(`${label} state digest is malformed`)
}

function validateDiscovery(value) {
  const expected = ['get_campaign_summary', 'get_evaluation_summary']
  const valid = rows => Array.isArray(rows) && rows.length === 2 &&
    rows.map(row => row?.name).sort().join(',') === expected.join(',')
  if (!value || !valid(value.native_tools) || !valid(value.adapter_tools))
    throw new Error('native and adapter discovery must expose exactly the two reviewed tools')
  const campaign = value.native_tools.find(row => row.name === expected[0])
  const evaluation = value.native_tools.find(row => row.name === expected[1])
  const campaignAdapter = value.adapter_tools.find(row => row.name === expected[0])
  const evaluationAdapter = value.adapter_tools.find(row => row.name === expected[1])
  for (const row of [campaign, evaluation]) {
    if (row.annotations?.readOnlyHint !== true || row.annotations?.consequentialHint !== false ||
        row.annotations?.untrustedContentHint !== false)
      throw new Error('native read-only Hint annotations are not exact')
  }
  for (const row of [campaignAdapter, evaluationAdapter]) {
    const annotations = row.annotations || {}
    if (annotations.readOnly !== true || annotations.consequential === true || annotations.untrustedContent === true)
      throw new Error('adapter read-only annotation translation is invalid')
  }
  const c = campaign.inputSchema, e = evaluation.inputSchema
  if (c?.type !== 'object' || c.additionalProperties !== false ||
      !isDeepStrictEqual(c.required, ['campaign_id']) || c.properties?.campaign_id?.type !== 'string' ||
      !isDeepStrictEqual(c.properties?.campaign_id?.enum, ['fixture-mixed']) ||
      Object.keys(c.properties || {}).join(',') !== 'campaign_id')
    throw new Error('campaign tool input schema is not the exact bounded contract')
  if (e?.type !== 'object' || e.additionalProperties !== false || Object.keys(e.properties || {}).length !== 0 ||
      (e.required || []).length !== 0)
    throw new Error('evaluation tool input schema is not the exact empty-object contract')
}

function validateOracle(oracle, revision) {
  if (oracle.oracle_id !== EXPECTED_ORACLE_ID || oracle.source_revision !== revision ||
      oracle.source !== 'authored' || oracle.live_trials !== 0 || oracle.case_count !== 20 ||
      !isDeepStrictEqual(Object.keys(oracle.source_digests || {}).sort(), [...requiredOracleSources].sort()))
    throw new Error('authored oracle identity/provenance is incomplete')
  for (const file of requiredOracleSources) {
    if (sha(gitBlob(revision, file)) !== oracle.source_digests[file])
      throw new Error(`authored oracle source digest mismatch: ${file}`)
  }
  return Object.fromEntries(['source', 'live_trials', 'corpus_version', 'grader_version', 'case_count',
    'baseline_run_id', 'candidate_run_id', 'baseline_metrics', 'candidate_metrics', 'checks',
    'threshold_status', 'promotion_allowed'].map(key => [key, oracle[key]]))
}

export function validateWebmcp({ report, verifierRevision }) {
  const policy = JSON.parse(gitBlob(verifierRevision, 'harness/pr-verification-policy.json').toString('utf8'))
  const reportResult = validateReport(report, 'chromium-webmcp', policy)
  const discovery = attachment(report, 'webmcp-discovery', 'MCP-001')
  const campaignRow = attachment(report, 'webmcp-campaign', 'MCP-002')
  const evaluationRow = attachment(report, 'webmcp-evaluation', 'MCP-003')
  validateDiscovery(discovery)
  checkStatePair(campaignRow, 'campaign tool')
  checkStatePair(evaluationRow, 'evaluation tool')

  const expectedCampaign = JSON.parse(gitBlob(verifierRevision, 'frontend/src/showcase-export.json').toString('utf8'))
    .campaigns.find(row => row.id === 'fixture-mixed')
  const contract = JSON.parse(gitBlob(verifierRevision, 'samples/reconciliation/expectations.json').toString('utf8')).mixed
  if (!expectedCampaign || !contract || !isDeepStrictEqual(expectedCampaign.gate, contract.gate))
    throw new Error('pinned sanitized campaign projection does not agree with contract expectation')
  const campaignPayload = publicEnvelope(campaignRow.native_result)
  const campaignAdapterPayload = publicEnvelope(campaignRow.adapter_result)
  const wantedCampaign = { campaign_id: 'fixture-mixed', gate: contract.gate,
    completeness: expectedCampaign.completeness, evidence_ids: expectedCampaign.evidence.map(item => item.id) }
  if (!isDeepStrictEqual(campaignPayload, wantedCampaign) || !isDeepStrictEqual(campaignAdapterPayload, wantedCampaign))
    throw new Error('native/adapter campaign payload differs from independent campaign expectations')
  if (campaignPayload.gate.decision !== 'BLOCKED' ||
      !isDeepStrictEqual(campaignPayload.gate.reasons.map(row => row.code), ['REQUIRED_FAILURE', 'INSUFFICIENT_EVIDENCE']))
    throw new Error('campaign payload dropped the confirmed failure or missing-evidence reason')

  const oracle = JSON.parse(gitBlob(verifierRevision, 'harness/oracles/authored-evaluation-v1.json').toString('utf8'))
  const expectedEvaluation = validateOracle(oracle, verifierRevision)
  const evaluationPayload = publicEnvelope(evaluationRow.native_result)
  const evaluationAdapterPayload = publicEnvelope(evaluationRow.adapter_result)
  if (!isDeepStrictEqual(evaluationPayload, expectedEvaluation) ||
      !isDeepStrictEqual(evaluationAdapterPayload, expectedEvaluation))
    throw new Error('native/adapter evaluation payload differs from independently authored oracle')
  const marker = Buffer.from(EXPECTED_ORACLE_ID)
  const frontendRows = execFileSync('git', ['ls-tree', '-rz', verifierRevision, '--', 'frontend'], { cwd: ROOT })
    .toString('utf8').split('\0').filter(Boolean)
  for (const row of frontendRows) {
    const [, file] = row.split('\t', 2)
    if (file && execFileSync('git', ['show', `${verifierRevision}:${file}`], { cwd: ROOT }).includes(marker))
      throw new Error('oracle marker appears in frontend source tree')
  }
  for (const item of [...discovery.native_tools, ...discovery.adapter_tools]) {
    if (JSON.stringify(item).includes(EXPECTED_ORACLE_ID)) throw new Error('oracle identifier leaked into tool discovery')
  }
  return { result: 'PASS', project: 'chromium-webmcp', count: reportResult.count,
    native_tools: 2, adapter_tools: 2, campaign_reasons: ['REQUIRED_FAILURE', 'INSUFFICIENT_EVIDENCE'],
    evaluation_source: 'authored', live_trials: 0,
    oracle_sha256: sha(gitBlob(verifierRevision, 'harness/oracles/authored-evaluation-v1.json')) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
    for (const required of ['--report', '--verifier-revision']) if (!args.includes(required))
      throw new Error(`${required} required`)
    console.log(JSON.stringify(validateWebmcp({ report: readJson(option('--report')),
      verifierRevision: option('--verifier-revision') }), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}
