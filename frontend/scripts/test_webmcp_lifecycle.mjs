import { resolve, dirname, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { run, save, validate } from './foundation_report.mjs'
const expected = { 'unsupported environment preserves dashboard': null, 'duplicate initialization registers tools once': null, 'second-registration failure rolls back first': null, 'disposal unregisters tools and permits reinitialization': null }
const arg = process.argv.indexOf('--report')
if (arg < 0 || !process.argv[arg + 1]) throw new Error('--report required')
const report = resolve(process.argv[arg + 1]), root = dirname(report)
const records = { status: 'FAIL', commands: [] }
try {
  await rm(report, { force: true })
  await rm(join(root, 'discovery.json'), { force: true })
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, PW_BASE_URL: process.env.PW_BASE_URL, PW_OUTPUT_DIR: join(root, 'test-results'), PLAYWRIGHT_JSON_OUTPUT_FILE: join(root, 'discovery.json') }
  const list = await run(['node_modules/@playwright/test/cli.js', 'test', '--project=chromium-webmcp-lifecycle', '--list', '--reporter=json'], env)
  records.commands.push(list)
  if (list.exit_code !== 0 || list.timedOut) throw new Error('Lifecycle discovery failed')
  await validate(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'chromium-webmcp-lifecycle', expected, true)
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = report
  const execution = await run(['node_modules/@playwright/test/cli.js', 'test', '--project=chromium-webmcp-lifecycle', '--reporter=json'], env)
  records.commands.push(execution)
  if (execution.exit_code !== 0 || execution.timedOut) throw new Error('Lifecycle execution failed')
  records.inventory = await validate(report, 'chromium-webmcp-lifecycle', expected)
  records.status = 'PASS'
} catch (error) { records.reason = String(error).slice(0, 1200); process.exitCode = 1 }
await save(join(root, 'orchestrator.json'), records)
console.log(records.status)
