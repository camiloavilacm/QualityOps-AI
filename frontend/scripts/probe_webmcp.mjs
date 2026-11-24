import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const index = process.argv.indexOf('--output')
if (index < 0 || !process.argv[index + 1]) throw new Error('--output is required')
const output = resolve(process.argv[index + 1])
const record = { status: 'BLOCKED', environment: process.platform === 'linux' ? 'container-or-linux-host' : 'host-preparation-only', checks: {}, limitations: ['Host probe does not establish container isolation or verifier acceptance.'] }
const server = createServer((_req, res) => res.end('<!doctype html><link rel="icon" href="data:,"><h1>Capability probe</h1>'))
let browser
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  browser = await chromium.launch({ channel: 'chromium', chromiumSandbox: true, args: ['--enable-features=WebMCP'] })
  record.browser = browser.version()
  assert.equal(record.browser, '159.0.8154.6')
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  record.checks.native = await page.evaluate(async () => {
    const host = document.modelContext
    if (!host || !isSecureContext) throw new Error('Required document.modelContext secure surface absent')
    const controller = new AbortController()
    await host.registerTool({ name: 'foundation_probe', description: 'Bounded fixture-only capability probe', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false }, execute: () => ({ content: [{ type: 'text', text: 'fixture-ok' }], isError: false }) }, { signal: controller.signal })
    const project = tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: tool.annotations.readOnlyHint, consequentialHint: tool.annotations.consequentialHint, untrustedContentHint: tool.annotations.untrustedContentHint } })
    const tools = (await host.getTools()).map(project)
    const tool = (await host.getTools()).find(tool => tool.name === 'foundation_probe')
    const result = await host.executeTool(tool, {})
    window.__foundationProbeAbort = controller
    return { surface: 'document.modelContext', tools, result }
  })
  const native = record.checks.native.tools
  assert.equal(native.length, 1)
  assert.deepEqual(native[0].annotations, { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false })
  record.checks.adapter = { tools: await page.webmcp.tools(), result: await page.webmcp.callTool('foundation_probe', {}) }
  assert.equal(record.checks.adapter.tools.length, 1)
  assert.equal(record.checks.adapter.tools[0].annotations.readOnly, true)
  assert.notEqual(record.checks.adapter.tools[0].annotations.consequential, true)
  assert.notEqual(record.checks.adapter.tools[0].annotations.untrustedContent, true)
  assert.deepEqual(record.checks.adapter.result, { content: [{ type: 'text', text: 'fixture-ok' }], isError: false })
  const nativeResult = typeof record.checks.native.result === 'string' ? JSON.parse(record.checks.native.result) : record.checks.native.result
  assert.deepEqual(nativeResult, record.checks.adapter.result)
  record.checks.abort = await page.evaluate(async () => { window.__foundationProbeAbort.abort(); return (await document.modelContext.getTools()).length })
  assert.equal(record.checks.abort, 0)
  const unsupported = await browser.newContext()
  const unsupportedPage = await unsupported.newPage()
  await unsupportedPage.goto('about:blank')
  record.checks.unsupported = await unsupportedPage.evaluate(() => ({ surface: typeof document.modelContext, secure: isSecureContext }))
  assert.equal(record.checks.unsupported.surface, 'undefined')
  await unsupported.close()
  record.status = 'PASS'
} catch (error) { record.reason = error instanceof Error ? error.message.slice(0, 800) : 'Probe failed' }
finally {
  await browser?.close()
  await new Promise(done => server.close(done))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(record, null, 2) + '\n')
}
console.log(record.status)
if (record.status !== 'PASS') process.exitCode = 1
