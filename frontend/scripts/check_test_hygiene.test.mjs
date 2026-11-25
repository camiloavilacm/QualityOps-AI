import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, readFile, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanTree, readInventory, checkOrdinarySource, checkReadOnlyEvaluation, checkWebMCPSource, checkConfiguration, validateReport, frontendRoot, declarations } from './check_test_hygiene.mjs'
import { mutateExport, validateCanaryExecution } from './check_canary_regression.mjs'

const original = JSON.parse(await readFile(join(frontendRoot, 'tests/expected-tests.json')))
const ordinary = await readFile(join(frontendRoot, 'tests/mixed-campaign.spec.ts'), 'utf8')
const config = await readFile(join(frontendRoot, 'playwright.config.ts'), 'utf8')
const pkg = JSON.parse(await readFile(join(frontendRoot, 'package.json')))
const workflow = await readFile(join(frontendRoot, '../.github/workflows/ci.yml'), 'utf8')
async function workspace(t) {
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-hygiene-unit-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'frontend')
  await mkdir(root)
  for (const file of ['tests', 'playwright.config.ts', 'package.json']) await cp(join(frontendRoot, file), join(root, file), { recursive: true })
  await mkdir(join(temp, '.github/workflows'), { recursive: true })
  await writeFile(join(temp, '.github/workflows/ci.yml'), workflow)
  return root
}

test('actual reviewed tree, ordinary locators, fixture and protected meta policies pass', async () => {
  assert.equal((await scanTree()).files.length, 8)
})
test('statically analyzable locator repair preserves identities and assertions', () => {
  assert.equal(checkOrdinarySource('tests/mixed-campaign.spec.ts', ordinary.replace("name: /fixture-mixed/i", "name: /fixture-mixed renamed/i"))[0].minExpects, 7)
})
test('AST counts expect.poll once without matching comments or strings', () => {
  const source = "import {test, expect} from './fixtures/dashboard'; test('poll', async ({page})=>{ /* expect(false) */ const text='expect(false)'; await expect.poll(async()=>page.getByRole('heading').innerText()).toBe('hello') })"
  assert.equal(checkOrdinarySource('poll.spec.ts', source)[0].minExpects, 1)
})
test('fixture callbacks require arrow syntax', () => {
  const source = "import {test, expect} from './fixtures/dashboard'; test('function callback', function ({page}) { expect(page).toBeTruthy() })"
  assert.throws(() => checkOrdinarySource('function-callback.spec.ts', source), /Only direct arrow callbacks are permitted/)
})
test('validated hook fixtures receive their own locator scope', () => {
  const source = ordinary + "\ntest.beforeEach(async ({page}) => { await page.goto('/') })\n"
  assert.equal(checkOrdinarySource('hook.spec.ts', source).length, 1)
})
for (const filename of ['extra.spec.ts', 'extra.test.ts', 'extra.test.js', 'extra.spec.js', 'extra.spec.mts', 'extra.tsx']) test(`filesystem rejects unapproved ${filename}`, async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'tests', filename), "test('hidden',()=>{})")
  await assert.rejects(scanTree(root), /Unapproved test\/helper file/)
})
test('recursive helper directory cannot hide browser escape or declaration', async t => {
  const root = await workspace(t)
  await mkdir(join(root, 'tests/helpers/deep'), { recursive: true })
  await writeFile(join(root, 'tests/helpers/deep/escape.ts'), 'page.evaluate(() => localStorage.clear()); test("hidden",()=>{})')
  await assert.rejects(scanTree(root), /Unapproved test\/helper file/)
})
test('symlink directory escape rejected even when target contains approved-looking code', async t => {
  const root = await workspace(t)
  await symlink(frontendRoot, join(root, 'tests/escape'))
  await assert.rejects(scanTree(root), /Symlink forbidden/)
})
for (const [label, change] of [
  ['direct runner import', source => source.replace('./fixtures/dashboard', '@playwright/test')],
  ['test import alias', source => source.replace('expect, test', 'expect, test as t')],
  ['expect alias', source => source.replace('expect, test', 'expect as check, test')],
  ['missing fixture import', source => source.replace(/^import[^\n]+\n/, '')],
  ['skip', source => source.replace('test(', 'test.skip(')],
  ['only', source => source.replace('test(', 'test.only(')],
  ['fixme', source => source + '\ntest.fixme()'],
  ['expected failure', source => source + '\ntest.fail()'],
  ['slow', source => source + '\ntest.slow()'],
  ['soft assertion', source => source.replace('expect(page)', 'expect.soft(page)')],
  ['configured expectation', source => source + '\nexpect.configure({soft:true})'],
  ['API shadowing', source => source + '\nfunction helper(expect) {}'],
  ['external navigation', source => source.replace("page.goto('/')", "page.goto('https://example.invalid')")],
  ['test API alias', source => source + '\nconst t = test'],
  ['expect API alias', source => source + '\nconst check = expect'],
  ['fixture shadowed by object', source => source.replace('  await page.goto', '  { const page = { getByRole: ({}).constructor.constructor }; page.getByRole("return process.version")() }\n  await page.goto')],
  ['constructor based execution', source => source.replace('  await page.goto', '  await page.locator(".decision-value").constructor.constructor("return process.version")()\n  await page.goto')],
  ['prototype based execution', source => source.replace('  await page.goto', '  await page.locator(".decision-value").prototype.constructor("return process.version")()\n  await page.goto')],
  ['reflective destructuring and locator shadowing', source => source.replace('  await page.goto', `  const control = page.getByRole('heading')
  { const {constructor}=()=>{}; const control={click:constructor}; const generated=control.click('return process.version'); { const control={click:generated}; control.click(); } }
  await page.goto`)],
  ['namespace and cross-test locator names', source => source.replace('  await page.goto', `  const control = page.getByRole('heading')
  await page.goto`) + `
namespace control { export const getByRole=Object.getPrototypeOf; export const click=Object.getOwnPropertyDescriptor; export const press=control.click(control.getByRole(()=>{}),'constructor')!.value; export const fill=(control.press('return process.version')); }
control.fill()`],
  ['locator alias nested-block and outer-binding escape', source => source.replace('  await page.goto', `  { const control = page.getByRole('heading') }
  control.click()
  await page.goto`) + `
const control = { getByRole: Object.getPrototypeOf, click: Object.getOwnPropertyDescriptor, filter: JSON.parse, press: Array.from }
control.fill()`],
  ['for-of property mutation', source => source.replace('  await page.goto', `  const control: any = page.getByRole('heading')
  for (control.getByRole of [Object.getPrototypeOf]) {}
  for (control.click of [Object.getOwnPropertyDescriptor]) {}
  for (control.filter of [JSON.parse]) {}
  for (control.press of [Array.from]) {}
  await page.goto`)],
  ['named class expression locator shadow', source => source.replace('  await page.goto', `  const control=page.getByRole('heading')
  const unused=class control { static getByRole=Object.getPrototypeOf; static click=Object.getOwnPropertyDescriptor; static press=control.click(control.getByRole(()=>{}),'constructor')!.value; static fill=(control.press('return process.version')); static result=control.fill(); }
  await page.goto`)],
  ['nested polling callback cannot shadow page with a default', source => source.replace('  await page.goto', `  await expect.poll(async ({page} = {}) => { await page.goto('/'); return true }).toBeTruthy()
  await page.goto`)],
  ['named function expression cannot shadow page', source => source.replace('  await page.goto', `  await expect.poll(function page() { return page.goto('/') }).toBeTruthy()
  await page.goto`)],
  ['returned function call', source => source.replace('  await page.goto', '  page.getByRole("link")()\n  await page.goto')],
  ['returned locator method call', source => source.replace('  await page.goto', '  page.getByRole("link").filter({hasText:"x"})()\n  await page.goto')],
  ['dynamic import', source => source + "\nimport('node:fs')"],
  ['arbitrary static import', source => "import {readFile} from 'node:fs';\n" + source],
  ['computed evaluation escape', source => source + "\npage['evaluate']('bad')"],
  ['destructuring alias', source => source.replace('{ page }', '{ page: p }')],
  ['empty error swallow', source => source + '\ntry {} catch {}'],
  ['test use', source => source + '\ntest.use({})'],
  ['test extend', source => source + '\ntest.extend({})'],
]) test(`ordinary policy rejects ${label}`, () => assert.throws(() => checkOrdinarySource('mixed.spec.ts', change(ordinary))))
for (const method of ['evaluate', 'evaluateHandle', '$eval', '$$eval', 'addScriptTag', 'addInitScript', 'route', 'routeFromHAR', 'unroute', 'removeAllListeners', 'off', 'newContext', 'waitForTimeout']) test(`ordinary policy rejects browser ${method}`, () => {
  assert.throws(() => checkOrdinarySource('mixed.spec.ts', ordinary + `\npage.${method}(() => {})`))
})
test('assertion deletion fails reviewed per-test minimum', async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'tests/mixed-campaign.spec.ts'), ordinary.replace("  await expect(reasons).toHaveCount(2)\n", ''))
  await assert.rejects(scanTree(root), /Assertion minimum: DASH-003/)
})
test('changed title fails exact declaration identity', async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'tests/mixed-campaign.spec.ts'), ordinary.replace('mixed campaign displays BLOCKED', 'changed title displays BLOCKED'))
  await assert.rejects(scanTree(root), /Unknown\/missing test identity/)
})
test('removing designated step fails even when assertion count remains', async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'tests/mixed-campaign.spec.ts'), ordinary.replace('DASH-003-REASON-01', 'wrong-step'))
  await assert.rejects(scanTree(root), /Named step/)
})
test('fixture/meta exceptions cannot be expanded by candidate edits', async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'tests/meta/guard-verification.spec.ts'), (await readFile(join(root, 'tests/meta/guard-verification.spec.ts'), 'utf8')) + '\nprocess.exit(0)')
  await assert.rejects(scanTree(root), /Protected fixture\/meta source changed/)
})
test('multiple configuration files rejected', async t => {
  const root = await workspace(t)
  await writeFile(join(root, 'playwright.config.js'), 'export default {}')
  await assert.rejects(scanTree(root), /Exactly one Playwright configuration/)
})
test('duplicate stable IDs and identities rejected', () => {
  const duplicate = structuredClone(original)
  duplicate.projects.chromium.tests[1].id = duplicate.projects.chromium.tests[0].id
  assert.throws(() => readInventory(duplicate), /Duplicate stable ID/)
  const identity = structuredClone(original)
  identity.projects.chromium.tests[1].titlePath = identity.projects.chromium.tests[0].titlePath
  assert.throws(() => readInventory(identity), /Duplicate identity/)
})
test('pending WebMCP zero discovery never passes execution', async () => {
  assert.equal(original.projects['chromium-webmcp'].count, 3)
  const pending = structuredClone(original)
  pending.projects['chromium-webmcp'] = { state: 'pending-stage4', status: 'NOT INTRODUCED', count: 0, tests: [] }
  await assert.rejects(validateReport({ suites: [], errors: [] }, 'chromium-webmcp', pending, true), /not introduced/)
})
for (const [label, change] of [
  ['retries', value => value.replace('retries: 0', 'retries: 2')],
  ['focused-tests', value => value.replace('forbidOnly: true', 'forbidOnly: false')],
  ['server-reuse', value => value.replace('reuseExistingServer: false', 'reuseExistingServer: true')],
  ['parallel workers', value => value.replace('workers: 1', 'workers: 2')],
  ['browser sandbox', value => value.replace('chromiumSandbox: true', 'chromiumSandbox: false')],
  ['global exclusion', value => value.replace("testDir: './tests',", "testDir: './tests', testIgnore: [/meta/],")],
]) test(`configuration rejects ${label}`, () => assert.throws(() => checkConfiguration(change(config), pkg, workflow)))
test('workflow bypass and missing required commands rejected', () => {
  assert.throws(() => checkConfiguration(config, pkg, workflow + '\ncontinue-on-error: true'), /Workflow bypass/)
  assert.throws(() => checkConfiguration(config, pkg, workflow.replace('harness/run_pr_verification.mjs', 'replaced.mjs')), /Missing workflow command/)
  assert.throws(() => checkConfiguration(config, pkg, workflow.replace('node harness/run_pr_verification.mjs', '# node harness/run_pr_verification.mjs')), /Missing workflow command/)
  assert.throws(() => checkConfiguration(config, pkg, workflow.replace('frontend-e2e:', 'frontend-e2e:\n    if: false')), /Conditional verification bypass/)
  assert.throws(() => checkConfiguration(config, { ...pkg, scripts: { ...pkg.scripts, 'test:e2e': 'playwright test || true' } }, workflow), /Changed required script/)
})
test('read-only WebMCP evaluation permits bounded observations', () => {
  assert.equal(checkReadOnlyEvaluation('async () => ({tools: await document.modelContext.getTools(), dom: document.querySelector("main").textContent, url: location.href, stored: localStorage.getItem("fixture")})'), true)
})
for (const source of ['() => localStorage.clear()', '() => document.querySelector("main").remove()', '() => document.modelContext.registerTool({})', '() => fetch("https://example.invalid")', '() => { document.title = "mutated" }', '() => new Function("bad")()']) test(`WebMCP evaluation rejects mutation/escape ${source}`, () => assert.throws(() => checkReadOnlyEvaluation(source)))

// Synthetic reporter fixtures exercise validation only; actual browser reports are run separately.
function syntheticReport() {
  const entry = original.projects.chromium.tests[0]
  return { errors: [], suites: [{ title: entry.file.replace(/^tests\//, ''), specs: [], suites: [{ title: entry.titlePath[0], specs: [{ title: entry.titlePath[1], file: entry.file.replace(/^tests\//, ''), tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [], attachments: [{name:'guard-diagnostics',body:Buffer.from('{"codes":[]}').toString('base64')}] }] }] }] }] }] }
}
const one = { ...original, projects: { ...original.projects, chromium: { ...original.projects.chromium, count: 1, tests: [original.projects.chromium.tests[0]] } } }
test('synthetic exact one-attempt execution accepted', async () => assert.equal(await validateReport(syntheticReport(), 'chromium', one, true), 1))
for (const [label, mutate] of [
  ['missing', report => { report.suites = [] }],
  ['duplicate', report => { report.suites.push(structuredClone(report.suites[0])) }],
  ['skipped', report => { report.suites[0].suites[0].specs[0].tests[0].results[0].status = 'skipped' }],
  ['expected failure', report => { report.suites[0].suites[0].specs[0].tests[0].expectedStatus = 'failed' }],
  ['retry', report => { report.suites[0].suites[0].specs[0].tests[0].results[0].retry = 1 }],
  ['two attempts', report => { const results = report.suites[0].suites[0].specs[0].tests[0].results; results.push(structuredClone(results[0])) }],
  ['wrong outcome', report => { report.suites[0].suites[0].specs[0].tests[0].status = 'unexpected' }],
  ['runner fatal', report => { report.errors = [{message:'synthetic crash'}] }],
]) test(`synthetic execution rejects ${label}`, async () => { const report = syntheticReport(); mutate(report); await assert.rejects(validateReport(report, 'chromium', one, true)) })

test('canary mutation changes exactly one reason and preserves all other fields', async () => {
  const value = JSON.parse(await readFile(join(frontendRoot, 'src/showcase-export.json')))
  const { mutated, removedReason } = mutateExport(value)
  assert.equal(removedReason.code, 'INSUFFICIENT_EVIDENCE')
  assert.equal(mutated.campaigns.find(row => row.id === 'fixture-mixed').gate.reasons.length, 1)
  const absent = structuredClone(mutated)
  assert.throws(() => mutateExport(absent), /Exactly one missing-evidence reason/)
  const duplicate = structuredClone(value); duplicate.campaigns[0].gate.reasons.push(removedReason)
  assert.throws(() => mutateExport(duplicate), /Exactly one missing-evidence reason/)
})
test('canary rejects unrelated failures and wrong designated step', () => {
  const entry = original.projects.chromium.tests.find(item => item.id === 'DASH-003')
  const report = {errors:[],suites:[{title:'mixed-campaign.spec.ts', specs:[{title:entry.titlePath[0],file:'mixed-campaign.spec.ts',tests:[{projectName:'chromium',expectedStatus:'passed',status:'unexpected',results:[{status:'failed',retry:0,errors:[{message:'Insufficient evidence'}],steps:[{title:'wrong-step',error:{message:'synthetic'}}]}]}]}]}]}
  assert.throws(() => validateCanaryExecution(report, entry, true), /Only designated assertion step/)
})


test('protected WebMCP source has explicit native and read-only evaluation policies', async () => {
  const source = await readFile(join(frontendRoot, 'tests/webmcp.spec.ts'), 'utf8')
  assert.equal(checkWebMCPSource('tests/webmcp.spec.ts', source).length, 3)
  assert.throws(() => checkWebMCPSource('tests/webmcp.spec.ts', source + '\npage.evaluate(() => localStorage.clear())'), /Unapproved read-only operation/)
  assert.throws(() => checkWebMCPSource('tests/webmcp.spec.ts', source + '\npage.evaluate(() => document.title = "mutated")'), /mutation/)
  assert.throws(() => checkWebMCPSource('tests/webmcp.spec.ts', source + '\npage.evaluate(() => document.modelContext.registerTool({}))'), /Unapproved read-only operation/)
  assert.throws(() => checkWebMCPSource('tests/webmcp.spec.ts', source + '\npage.evaluate(() => window.qualityopsRecordedState, {hidden: "runner-data"})'), /cannot receive runner data/)
  assert.throws(() => checkWebMCPSource('tests/webmcp.spec.ts', "import oracle from '../../harness/oracles/authored-evaluation-v1.json';\n" + source), /named imports/)
})
