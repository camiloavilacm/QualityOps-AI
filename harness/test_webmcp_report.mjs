import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { validateWebmcp } from './check_webmcp_report.mjs'

const verifierRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const blob = file => JSON.parse(execFileSync('git', ['show', `${verifierRevision}:${file}`], { encoding: 'utf8' }))
const publicEvaluation = oracle => Object.fromEntries(['source', 'live_trials', 'corpus_version', 'grader_version', 'case_count',
  'baseline_run_id', 'candidate_run_id', 'baseline_metrics', 'candidate_metrics', 'checks', 'threshold_status', 'promotion_allowed']
  .map(key => [key, oracle[key]]))
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64')
const state = () => ({ url: 'http://127.0.0.1:4183/?view=evaluation', dom_sha256: 'a'.repeat(64),
  local_storage_sha256: 'b'.repeat(64), session_storage_sha256: 'c'.repeat(64), recorded_state_sha256: 'd'.repeat(64) })
function resultEnvelope(payload) { return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false } }
function attachment(name, value) { return { name, contentType: 'application/json', body: encode(value) } }
function report() {
  const policy = blob('harness/pr-verification-policy.json')
  const expected = blob('samples/reconciliation/expectations.json').mixed.gate
  const campaign = blob('frontend/src/showcase-export.json').campaigns.find(row => row.id === 'fixture-mixed')
  const oracle = blob('harness/oracles/authored-evaluation-v1.json')
  const rows = policy.projects['chromium-webmcp']
  const discovery = {
    native_tools: ['get_campaign_summary', 'get_evaluation_summary'].map(name => ({ name,
      description: name === 'get_campaign_summary' ? 'Read recorded sanitized campaign summary.' : 'Offline evaluation source: "authored", live_trials: 0.',
      inputSchema: name === 'get_campaign_summary'
        ? { type: 'object', properties: { campaign_id: { type: 'string', enum: ['fixture-mixed'] } }, required: ['campaign_id'], additionalProperties: false }
        : { type: 'object', properties: {}, required: [], additionalProperties: false },
      annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false } })),
    adapter_tools: ['get_campaign_summary', 'get_evaluation_summary'].map(name => ({ name,
      description: name === 'get_campaign_summary' ? 'Read recorded sanitized campaign summary.' : 'Offline evaluation source: "authored", live_trials: 0.',
      inputSchema: name === 'get_campaign_summary'
        ? { type: 'object', properties: { campaign_id: { type: 'string', enum: ['fixture-mixed'] } }, required: ['campaign_id'], additionalProperties: false }
        : { type: 'object', properties: {}, required: [], additionalProperties: false },
      annotations: { readOnly: true, consequential: false, untrustedContent: false } })),
  }
  const campaignPayload = { campaign_id: 'fixture-mixed', gate: expected, completeness: campaign.completeness,
    evidence_ids: campaign.evidence.map(item => item.id) }
  const evalPayload = publicEvaluation(oracle)
  const before = state(), after = structuredClone(before)
  const observations = {
    'webmcp-discovery': discovery,
    'webmcp-campaign': { native_result: resultEnvelope(campaignPayload), adapter_result: resultEnvelope(campaignPayload),
      state_before: before, state_after: after },
    'webmcp-evaluation': { native_result: resultEnvelope(evalPayload), adapter_result: resultEnvelope(evalPayload),
      state_before: before, state_after: after },
  }
  return { errors: [], suites: [{ title: 'webmcp.spec.ts', file: 'webmcp.spec.ts', specs: rows.map(row => ({
    title: row.titles[0], file: row.file.slice('tests/'.length), tests: [{ projectName: 'chromium-webmcp',
      expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed', errors: [], attachments: [
        { name: 'guard-diagnostics', contentType: 'application/json', body: encode({ codes: [] }) },
        ...(observations[row.id === 'MCP-001' ? 'webmcp-discovery' : row.id === 'MCP-002' ? 'webmcp-campaign' : 'webmcp-evaluation']
          ? [attachment(row.id === 'MCP-001' ? 'webmcp-discovery' : row.id === 'MCP-002' ? 'webmcp-campaign' : 'webmcp-evaluation',
            observations[row.id === 'MCP-001' ? 'webmcp-discovery' : row.id === 'MCP-002' ? 'webmcp-campaign' : 'webmcp-evaluation'])]
          : []),
      ] }] }] })) }] }
}

test('independent WebMCP validator accepts the exact campaign, authored oracle, annotations, and read-only record', () => {
  assert.equal(validateWebmcp({ report: report(), verifierRevision }).result, 'PASS')
})

for (const [label, mutate] of [
  ['drops the missing-evidence reason', value => {
    const item = value.suites[0].specs[1].tests[0].results[0].attachments.find(row => row.name === 'webmcp-campaign')
    const observation = JSON.parse(Buffer.from(item.body, 'base64'))
    const payload = JSON.parse(observation.native_result.content[0].text)
    payload.gate.reasons.pop(); observation.native_result = resultEnvelope(payload); item.body = encode(observation)
  }],
  ['changes a native Hint', value => {
    const item = value.suites[0].specs[0].tests[0].results[0].attachments.find(row => row.name === 'webmcp-discovery')
    const discovery = JSON.parse(Buffer.from(item.body, 'base64'))
    discovery.native_tools[0].annotations.readOnlyHint = false; item.body = encode(discovery)
  }],
  ['changes an authored evaluation value', value => {
    const item = value.suites[0].specs[2].tests[0].results[0].attachments.find(row => row.name === 'webmcp-evaluation')
    const observation = JSON.parse(Buffer.from(item.body, 'base64'))
    const payload = JSON.parse(observation.native_result.content[0].text)
    payload.live_trials = 1; observation.native_result = resultEnvelope(payload); item.body = encode(observation)
  }],
  ['changes observed state', value => {
    const item = value.suites[0].specs[1].tests[0].results[0].attachments.find(row => row.name === 'webmcp-campaign')
    const observation = JSON.parse(Buffer.from(item.body, 'base64')); observation.state_after.url += '&changed=1'; item.body = encode(observation)
  }],
  ['moves an attachment to a different test', value => {
    const source = value.suites[0].specs[0].tests[0].results[0].attachments.pop()
    value.suites[0].specs[1].tests[0].results[0].attachments.push(source)
  }],
]) test(`rejects WebMCP evidence that ${label}`, () => {
  const value = report(); mutate(value)
  assert.throws(() => validateWebmcp({ report: value, verifierRevision }))
})
