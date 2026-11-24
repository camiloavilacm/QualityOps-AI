import { test as base, expect, type Request, type Frame } from '@playwright/test'

/** Automatic production guard; diagnostic payloads intentionally omit untrusted text/URLs. */
export const test = base.extend<{ guardErrors: void }>({
  guardErrors: [async ({ context, baseURL }, use, testInfo) => {
    const codes: string[] = []
    let overflow = false
    const add = (code: string) => { if (codes.length < 32) codes.push(code); else overflow = true }
    const origin = baseURL ? new URL(baseURL).origin : undefined
    let sequence = 0
    const starts = new Map<Request, number>()
    const committed = new Map<Frame, { sequence: number, url: string }>()
    const aborted: { frame: Frame, start: number, url: string }[] = []
    const webError = () => add('UNCAUGHT_JS_ERROR')
    const consoleError = (message: { type(): string }) => { if (message.type() === 'error') add('CONSOLE_ERROR') }
    const request = (item: Request) => { if (item.isNavigationRequest()) starts.set(item, ++sequence) }
    const response = (item: import('@playwright/test').Response) => {
      if (origin && new URL(item.url()).origin === origin && item.status() >= 400) add(`HTTP_${item.status()}`)
      if (item.request().isNavigationRequest() && item.status() < 400) {
        committed.set(item.frame(), { sequence: ++sequence, url: item.url() })
      }
    }
    const failed = (item: Request) => {
      const failure = item.failure()?.errorText
      if (item.isNavigationRequest() && failure === 'net::ERR_ABORTED') {
        aborted.push({ frame: item.frame(), start: starts.get(item) ?? Number.MAX_SAFE_INTEGER, url: item.url() })
      } else add('REQUEST_FAILED')
    }
    context.on('weberror', webError)
    context.on('console', consoleError)
    context.on('request', request)
    context.on('response', response)
    context.on('requestfailed', failed)
    try { await use() } finally {
      context.off('weberror', webError)
      context.off('console', consoleError)
      context.off('request', request)
      context.off('response', response)
      context.off('requestfailed', failed)
      for (const item of aborted) {
        const destination = committed.get(item.frame)
        if (!destination || destination.sequence <= item.start || destination.url === item.url || item.frame.url() !== destination.url) add('REQUEST_FAILED')
      }
      if (overflow) codes.push('DIAGNOSTIC_LIMIT')
      await testInfo.attach('guard-diagnostics', { body: JSON.stringify({ codes }), contentType: 'application/json' })
      expect(codes, `DASHBOARD_GUARD ${codes.join(',')}`).toEqual([])
    }
  }, { auto: true }],
})
export { expect }
