import { test, expect } from './fixtures/dashboard'
import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'

type Envelope = { content: [{ type: 'text'; text: string }]; isError: boolean }
type CampaignSummary = {
  campaign_id: string; completeness: string; evidence_ids: string[]
  gate: { schema_version: string; campaign_id: string; decision: string; policy_version: string; policy_sha256: string; evidence_sha256: string; evaluated_at: string; reasons: { code: string; execution_id: string; artifact_ids: string[] }[] }
}
type Rate = { count: number; denominator: number; rate: number | null }
type EvaluationSummary = {
  source: string; live_trials: number; corpus_version: string; grader_version: string; case_count: number
  baseline_run_id: string; candidate_run_id: string; baseline_metrics: Record<string, Rate>; candidate_metrics: Record<string, Rate>
  checks: Record<string, { observed: number | null; operator: string; limit: number | null; status: string }>
  threshold_status: string; promotion_allowed: boolean
}
const names = ['get_campaign_summary', 'get_evaluation_summary']
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function envelope(value: unknown): Envelope {
  const decoded: unknown = typeof value === 'string' ? JSON.parse(value) : value
  expect(decoded).toEqual({ content: [{ type: 'text', text: expect.any(String) }], isError: expect.any(Boolean) })
  const result = decoded as Envelope
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16_384)
  return result
}
async function snapshot(page: Page) {
  const state = await page.evaluate(() => ({
    url: location.href,
    dom: document.documentElement.outerHTML,
    local_storage: JSON.stringify(Object.entries(localStorage)),
    session_storage: JSON.stringify(Object.entries(sessionStorage)),
    recorded_state: window.qualityopsRecordedState,
  }))
  expect(state.recorded_state).toEqual(expect.any(String))
  expect(state.dom.length).toBeLessThan(128_000)
  return { url: state.url, dom_sha256: hash(state.dom), local_storage_sha256: hash(state.local_storage), session_storage_sha256: hash(state.session_storage), recorded_state_sha256: hash(state.recorded_state ?? '') }
}
async function nativeCampaign(page: Page) {
  return envelope(await page.evaluate(async () => {
    if (!document.modelContext) throw 'Required native surface unavailable'
    const tools = await document.modelContext.getTools()
    const tool = tools.find(tool => tool.name === 'get_campaign_summary')
    if (!tool) throw 'Campaign tool unavailable'
    return await document.modelContext.executeTool(tool, { campaign_id: 'fixture-mixed' })
  }))
}
async function nativeEvaluation(page: Page) {
  return envelope(await page.evaluate(async () => {
    if (!document.modelContext) throw 'Required native surface unavailable'
    const tools = await document.modelContext.getTools()
    const tool = tools.find(tool => tool.name === 'get_evaluation_summary')
    if (!tool) throw 'Evaluation tool unavailable'
    return await document.modelContext.executeTool(tool, {})
  }))
}
async function ready(page: Page) {
  await expect.poll(async () => (await page.webmcp.tools()).map(tool => tool.name).sort()).toEqual(names)
}
const rateText = (metric: Rate) => metric.rate === null ? `n/a (${metric.count}/${metric.denominator})` : `${Math.round(metric.rate * 100)}% (${metric.count}/${metric.denominator})`

test('MCP-001 discovers exact native and adapter read-only tool contracts after initialization', async ({ page }, testInfo) => {
  await page.goto('/')
  await ready(page)
  const native_tools = await page.evaluate(async () => {
    if (!document.modelContext) throw 'Required native surface unavailable'
    const tools = await document.modelContext.getTools()
    return tools.map(tool => ({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.annotations.readOnlyHint, consequentialHint: tool.annotations.consequentialHint, untrustedContentHint: tool.annotations.untrustedContentHint },
    }))
  })
  const adapter_tools = await page.webmcp.tools()
  const observer = await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'qualityopsRecordedState')
    return { configurable: descriptor?.configurable, has_setter: descriptor?.set !== undefined }
  })
  expect(observer).toEqual({ configurable: false, has_setter: false })
  expect(native_tools.map(tool => tool.name).sort()).toEqual(names)
  expect(native_tools).toHaveLength(2)
  for (const tool of native_tools) {
    expect(Object.keys(tool).sort()).toEqual(['annotations', 'description', 'inputSchema', 'name'])
    expect(tool.annotations).toEqual({ readOnlyHint: true, consequentialHint: false, untrustedContentHint: false })
    expect(tool.description.length).toBeLessThan(256)
    expect(tool.inputSchema).toEqual(tool.name === 'get_campaign_summary'
      ? { type: 'object', properties: { campaign_id: { type: 'string', enum: ['fixture-mixed'] } }, required: ['campaign_id'], additionalProperties: false }
      : { type: 'object', properties: {}, required: [], additionalProperties: false })
  }
  for (const tool of adapter_tools) {
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.consequential).not.toBe(true)
    expect(tool.annotations?.untrustedContent).not.toBe(true)
    expect(tool.inputSchema).toEqual(native_tools.find(native => native.name === tool.name)?.inputSchema)
  }
  expect(native_tools.find(tool => tool.name === 'get_evaluation_summary')?.description).toContain('source: "authored", live_trials: 0')
  expect(envelope(await page.webmcp.callTool('get_campaign_summary', { campaign_id: 'fixture-mixed' }, { timeout: 5_000 })).isError).toBe(false)
  // A new document reinitializes the real application. Same-document idempotence is covered in the protected lifecycle project.
  await page.reload()
  await ready(page)
  expect((await page.webmcp.tools()).map(tool => tool.name).sort()).toEqual(names)
  const observation = JSON.stringify({ native_tools, adapter_tools })
  expect(Buffer.byteLength(observation)).toBeLessThanOrEqual(256 * 1024)
  await testInfo.attach('webmcp-discovery', { body: observation, contentType: 'application/json' })
})

test('MCP-002 preserves the displayed mixed campaign and rejects invalid summary arguments without state changes', async ({ page }, testInfo) => {
  await page.goto('/?campaign=fixture-mixed')
  await ready(page)
  await expect(page.locator('.decision-value')).toHaveText('BLOCKED')
  const state_before = await snapshot(page)
  const native_result = await nativeCampaign(page)
  const adapter_result = envelope(await page.webmcp.callTool('get_campaign_summary', { campaign_id: 'fixture-mixed' }, { timeout: 5_000 }))
  expect(native_result).toEqual(adapter_result)
  expect(adapter_result.isError).toBe(false)
  const payload = JSON.parse(adapter_result.content[0].text) as CampaignSummary
  expect(Object.keys(payload).sort()).toEqual(['campaign_id', 'completeness', 'evidence_ids', 'gate'])
  expect(payload.campaign_id).toBe('fixture-mixed')
  expect(payload.completeness).toBe('partial')
  expect(payload.evidence_ids).toEqual(['x'])
  expect(Object.keys(payload.gate).sort()).toEqual(['campaign_id', 'decision', 'evaluated_at', 'evidence_sha256', 'policy_sha256', 'policy_version', 'reasons', 'schema_version'])
  expect(payload.gate.schema_version).toBe('2.0.0-draft.1')
  expect(payload.gate.campaign_id).toBe(payload.campaign_id)
  expect(payload.gate.decision).toBe('BLOCKED')
  expect(payload.gate.policy_version).toBe('mandatory-v2')
  expect(payload.gate.evidence_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(payload.gate.policy_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(payload.gate.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  expect(payload.gate.reasons).toEqual([{ artifact_ids: ['x'], code: 'REQUIRED_FAILURE', execution_id: 'x' }, { artifact_ids: [], code: 'INSUFFICIENT_EVIDENCE', execution_id: 'y' }])
  const reasons = page.getByRole('region', { name: 'Decision reasons' }).getByRole('listitem')
  await expect(reasons).toHaveCount(payload.gate.reasons.length)
  for (const reason of payload.gate.reasons) {
    await expect(reasons.filter({ hasText: reason.code })).toContainText(`Execution ${reason.execution_id}`)
  }
  await expect(page.locator('#evidence-x')).toBeVisible()
  for (const input of [undefined, null, [], {}, 1, { campaign_id: 1 }, { campaign_id: 'fixture-pass' }, { campaign_id: 'fixture-mixed', extra: true }]) {
    const result = envelope(await page.webmcp.callTool('get_campaign_summary', input as Record<string, unknown>, { timeout: 5_000 }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('{"error":"Invalid arguments."}')
  }
  expect(await nativeCampaign(page)).toEqual(native_result)
  const state_after = await snapshot(page)
  expect(state_after).toEqual(state_before)
  const observation = JSON.stringify({ native_result, adapter_result, state_before, state_after })
  expect(Buffer.byteLength(observation)).toBeLessThanOrEqual(256 * 1024)
  await testInfo.attach('webmcp-campaign', { body: observation, contentType: 'application/json' })
})

test('MCP-003 returns only the authored zero-live-trial evaluation and preserves observed state', async ({ page }, testInfo) => {
  await page.goto('/?view=evaluation')
  await ready(page)
  const offline = page.getByRole('region', { name: /Offline Authored Replay Baseline vs\. Candidate/ })
  await expect(offline).toBeVisible()
  const state_before = await snapshot(page)
  const native_result = await nativeEvaluation(page)
  const adapter_result = envelope(await page.webmcp.callTool('get_evaluation_summary', {}, { timeout: 5_000 }))
  expect(native_result).toEqual(adapter_result)
  expect(adapter_result.isError).toBe(false)
  const payload = JSON.parse(adapter_result.content[0].text) as EvaluationSummary
  expect(Object.keys(payload).sort()).toEqual(['baseline_metrics', 'baseline_run_id', 'candidate_metrics', 'candidate_run_id', 'case_count', 'checks', 'corpus_version', 'grader_version', 'live_trials', 'promotion_allowed', 'source', 'threshold_status'])
  expect(payload.source).toBe('authored')
  expect(payload.live_trials).toBe(0)
  expect(payload.promotion_allowed).toBe(false)
  expect(payload.threshold_status).toBe('indeterminate')
  expect(payload.case_count).toBe(20)
  expect(payload.corpus_version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(payload.grader_version).toMatch(/^\d+\.\d+\.\d+$/)
  await expect(offline).toContainText(`${payload.case_count} cases, 0 live trials`)
  await expect(offline).toContainText(payload.baseline_run_id)
  await expect(offline).toContainText(payload.candidate_run_id)
  const labels: Record<string, string> = { diagnosis_accuracy: 'Diagnosis accuracy', citation_validity: 'Citation validity', claim_support: 'Claim support', correct_abstention: 'Correct abstention', invalid_output: 'Invalid output', safety_violation: 'Safety violations', 'pass@3': 'pass@3 (3-trial groups)', 'pass^3': 'pass^3 (3-trial groups)' }
  expect(Object.keys(payload.baseline_metrics).sort()).toEqual(Object.keys(labels).sort())
  expect(Object.keys(payload.candidate_metrics).sort()).toEqual(Object.keys(labels).sort())
  for (const [key, label] of Object.entries(labels)) {
    const row = offline.getByRole('row').filter({ has: page.getByRole('cell', { name: label, exact: true }) })
    await expect(row.getByRole('cell').nth(1)).toHaveText(rateText(payload.baseline_metrics[key]))
    await expect(row.getByRole('cell').nth(2)).toHaveText(rateText(payload.candidate_metrics[key]))
  }
  const checks = page.getByRole('region', { name: 'Offline Authored SPEC §9 Threshold Checks (promotion_allowed: false)' })
  for (const [key, check] of Object.entries(payload.checks)) {
    const row = checks.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) })
    await expect(row.getByRole('cell').nth(1)).toHaveText(check.observed === null ? 'unmeasured' : String(check.observed))
    await expect(row.getByRole('cell').nth(2)).toHaveText(`${check.operator} ${check.limit === null ? 'n/a' : String(check.limit)}`)
    await expect(row.getByRole('cell').nth(3)).toHaveText(check.status)
  }
  for (const input of [null, [], 1, { extra: true }]) {
    const result = envelope(await page.webmcp.callTool('get_evaluation_summary', input as Record<string, unknown>, { timeout: 5_000 }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('{"error":"Invalid arguments."}')
  }
  // The adapter normalizes omitted input to {}; handler-level undefined rejection is a lifecycle meta assertion.
  expect(envelope(await page.webmcp.callTool('get_evaluation_summary', undefined, { timeout: 5_000 }))).toEqual(adapter_result)
  expect(await nativeEvaluation(page)).toEqual(native_result)
  const state_after = await snapshot(page)
  expect(state_after).toEqual(state_before)
  const observation = JSON.stringify({ native_result, adapter_result, state_before, state_after })
  expect(Buffer.byteLength(observation)).toBeLessThanOrEqual(256 * 1024)
  await testInfo.attach('webmcp-evaluation', { body: observation, contentType: 'application/json' })
})
