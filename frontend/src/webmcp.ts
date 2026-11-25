import showcase from './showcase-export.json' with { type: 'json' }

/** Transactional registration shared by native dashboard tools and lifecycle meta-tests. */
export interface RegistrationHost {
  registerTool(tool: NativeToolDefinition, options: { signal: AbortSignal }): unknown | Promise<unknown>
}
export function createToolLifecycle() {
  let controller: AbortController | undefined
  let pending: Promise<boolean> | undefined
  const dispose = () => { controller?.abort(); controller = undefined; pending = undefined }
  const initialize = (host: RegistrationHost | undefined, tools: readonly NativeToolDefinition[]): Promise<boolean> => {
    if (!host) return Promise.resolve(false)
    if (pending) return pending
    const active = new AbortController()
    controller = active
    const attempt = async () => {
      try {
        for (const tool of tools) {
          if (active.signal.aborted) return false
          await host.registerTool(tool, { signal: active.signal })
        }
        return !active.signal.aborted
      } catch {
        active.abort()
        if (controller === active) { controller = undefined; pending = undefined }
        return false
      }
    }
    // Defer host invocation so synchronous host failure cannot retain stale pending state.
    pending = Promise.resolve().then(attempt)
    return pending
  }
  return { initialize, dispose }
}

// These are public recorded projections only. No evaluator labels or live client is imported.

export type SummaryEnvelope = { content: [{ type: 'text'; text: string }]; isError: boolean }
export const MAX_SUMMARY_BYTES = 16_384
const invalidArguments = () => envelope({ error: 'Invalid arguments.' }, true)
function envelope(payload: unknown, isError = false): SummaryEnvelope {
  const text = JSON.stringify(payload)
  const result: SummaryEnvelope = { content: [{ type: 'text', text }], isError }
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_SUMMARY_BYTES) {
    return { content: [{ type: 'text', text: '{"error":"Summary unavailable."}' }], isError: true }
  }
  return result
}
function plainObject(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}
function campaignProjection() {
  const campaign = showcase.campaigns.find(entry => entry.id === 'fixture-mixed')
  if (!campaign || !campaign.gate) throw new Error('Recorded summary unavailable')
  return {
    campaign_id: campaign.id,
    gate: campaign.gate,
    completeness: campaign.completeness,
    evidence_ids: campaign.evidence.map(evidence => evidence.id),
  }
}
const recordedProjection = () => ({ campaign: campaignProjection(), evaluation: showcase.evaluation })

/** Fresh definitions keep application handlers independent of browser argument normalization. */
export function createDashboardTools(): NativeToolDefinition[] {
  const annotations = { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false }
  return [
    {
      name: 'get_campaign_summary',
      description: 'Read the recorded sanitized fixture-mixed campaign gate, completeness and evidence identifiers. Advisory presentation only.',
      inputSchema: { type: 'object', properties: { campaign_id: { type: 'string', enum: ['fixture-mixed'] } }, required: ['campaign_id'], additionalProperties: false },
      annotations: { ...annotations },
      execute: input => {
        try {
          if (!plainObject(input)) return invalidArguments()
          const keys = Reflect.ownKeys(input)
          const campaign = Object.getOwnPropertyDescriptor(input, 'campaign_id')
          if (keys.length !== 1 || keys[0] !== 'campaign_id' || !campaign || !('value' in campaign) || campaign.value !== 'fixture-mixed') return invalidArguments()
          return envelope(campaignProjection())
        } catch { return envelope({ error: 'Summary unavailable.' }, true) }
      },
    },
    {
      name: 'get_evaluation_summary',
      description: 'Read the offline authored evaluation summary: source: "authored", live_trials: 0. No live inference or live benchmark data.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      annotations: { ...annotations },
      execute: input => {
        try {
          if (!plainObject(input) || Reflect.ownKeys(input).length !== 0) return invalidArguments()
          return envelope(showcase.evaluation)
        } catch { return envelope({ error: 'Summary unavailable.' }, true) }
      },
    },
  ]
}

declare global { interface Window { readonly qualityopsRecordedState?: string } }
const dashboardLifecycle = createToolLifecycle()

/** Nonconfigurable read-only observation of the same sanitized projections, with no controls. */
function installRecordedStateObservation() {
  if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, 'qualityopsRecordedState')) {
    Object.defineProperty(window, 'qualityopsRecordedState', {
      get: () => JSON.stringify(recordedProjection()), enumerable: false, configurable: false,
    })
  }
}
export function initializeDashboardTools(): Promise<boolean> {
  try {
    installRecordedStateObservation()
    const host = typeof document === 'undefined' ? undefined : document.modelContext
    return dashboardLifecycle.initialize(host, createDashboardTools())
  } catch { return Promise.resolve(false) }
}
export function disposeDashboardTools() { dashboardLifecycle.dispose() }
