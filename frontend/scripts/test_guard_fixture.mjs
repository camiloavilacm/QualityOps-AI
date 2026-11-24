import { createServer } from 'node:http'
import { resolve, dirname, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { run, save, validate } from './foundation_report.mjs'

const expected = { 'clean-page': null, 'uncaught-js-error': 'UNCAUGHT_JS_ERROR', 'console-error': 'CONSOLE_ERROR', 'same-origin-404': 'HTTP_404', 'same-origin-500': 'HTTP_500', 'request-failed': 'REQUEST_FAILED', 'second-tab-error': 'UNCAUGHT_JS_ERROR', 'navigation-abort': null }
const arg = process.argv.indexOf('--report')
if (arg < 0 || !process.argv[arg + 1]) throw new Error('--report required')
const report = resolve(process.argv[arg + 1])
const root = dirname(report)
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path === '/disconnect') return request.socket.destroy()
  if (path === '/slow') return
  if (path === '/404' || path === '/500') { response.writeHead(Number(path.slice(1))); response.end('deliberate fixture error'); return }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><link rel="icon" href="data:,"><h1>Clean fixture</h1>${path === '/uncaught' ? '<script>setTimeout(() => { throw new Error("synthetic fixture error") },0)</script>' : path === '/console' ? '<script>console.error("synthetic fixture error")</script>' : ''}`)
})
const records = { status: 'FAIL', commands: [], cases: expected }
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, PW_BASE_URL: `http://127.0.0.1:${server.address().port}`, PW_OUTPUT_DIR: join(root, 'test-results'), PLAYWRIGHT_JSON_OUTPUT_FILE: join(root, 'discovery.json') }
  await rm(report, { force: true })
  await rm(join(root, 'discovery.json'), { force: true })
  const list = await run(['node_modules/@playwright/test/cli.js', 'test', '--project=chromium-guard-meta', '--list', '--reporter=json'], env)
  records.commands.push(list)
  if (list.exit_code !== 0 || list.timedOut) throw new Error('Guard discovery failed')
  await validate(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'chromium-guard-meta', expected, true)
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = report
  const execution = await run(['node_modules/@playwright/test/cli.js', 'test', '--project=chromium-guard-meta', '--reporter=json'], env)
  records.commands.push(execution)
  if (execution.exit_code !== 1 || execution.timedOut) throw new Error('Expected intentional guard failures, not a crash/timeout')
  records.inventory = await validate(report, 'chromium-guard-meta', expected)
  records.status = 'PASS'
} catch (error) { records.reason = String(error).slice(0, 1200); process.exitCode = 1 }
finally { server.closeAllConnections(); await new Promise(done => server.close(done)); await save(join(root, 'orchestrator.json'), records) }
console.log(records.status)
