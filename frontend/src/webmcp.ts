/** Transactional lifecycle foundation. Dashboard summary registration waits for Stage 4. */
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
