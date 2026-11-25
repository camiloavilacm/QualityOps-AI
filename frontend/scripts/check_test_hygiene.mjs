import ts from 'typescript'
import assert from 'node:assert/strict'
import { readFile, readdir, lstat, realpath, mkdtemp, rm, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { run, save, tests as reportTests } from './foundation_report.mjs'

export const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projects = ['chromium', 'chromium-guard-meta', 'chromium-webmcp', 'chromium-webmcp-lifecycle']
const ordinaryFiles = ['tests/seed.spec.ts', 'tests/mixed-campaign.spec.ts', 'tests/dashboard-flows.spec.ts']
const protectedFiles = ['tests/fixtures/dashboard.ts', 'tests/meta/guard-verification.spec.ts', 'tests/meta/webmcp-lifecycle.spec.ts']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const identity = entry => JSON.stringify([entry.project, entry.file, entry.titlePath])
const syntax = (file, source) => {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(tree.parseDiagnostics.length, 0, `Invalid TypeScript: ${file}`)
  return tree
}
const visit = (node, callback) => { callback(node); ts.forEachChild(node, child => visit(child, callback)) }
const name = node => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? `${name(node.expression)}.${node.name.text}` : ts.isCallExpression(node) ? name(node.expression) : ''
const textLiteral = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
const callbackOf = node => node.arguments.find(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))

export function readInventory(value) {
  assert.equal(value.version, 'stage2-1')
  assert.deepEqual(Object.keys(value.projects).sort(), [...projects].sort(), 'Four explicit project contracts')
  const ids = new Set(), keys = new Set()
  for (const project of projects) {
    const contract = value.projects[project]
    assert.ok(['active', 'pending-stage4'].includes(contract.state))
    assert.equal(contract.count, contract.tests.length)
    if (contract.state === 'active') { assert.ok(contract.count > 0, 'Empty active project'); assert.equal(contract.status, 'INTRODUCED') }
    else { assert.equal(contract.count, 0); assert.equal(contract.status, 'NOT INTRODUCED') }
    for (const entry of contract.tests) {
      assert.equal(entry.project, project)
      assert.ok(/^[A-Z]+-\d{3}$/.test(entry.id))
      assert.ok(!ids.has(entry.id), 'Duplicate stable ID'); ids.add(entry.id)
      assert.ok(!keys.has(identity(entry)), 'Duplicate identity'); keys.add(identity(entry))
      assert.ok(typeof entry.file === 'string' && !entry.file.includes('..') && entry.file.startsWith('tests/'))
      assert.ok(Array.isArray(entry.titlePath) && entry.titlePath.length > 0 && entry.titlePath.every(item => typeof item === 'string' && item.length > 0))
      assert.ok(Number.isInteger(entry.minExpects) && entry.minExpects >= 0)
    }
  }
  const mixed = value.projects.chromium.tests.find(entry => entry.id === 'DASH-003')
  assert.equal(mixed?.stepId, 'DASH-003-REASON-01')
  assert.deepEqual(Object.keys(value.protectedSources).sort(), [...protectedFiles].sort())
  assert.deepEqual(value.helperFiles, [], 'New helpers require separate policy review')
  return value
}

export function declarations(file, source) {
  const tree = syntax(file, source), result = []
  function walk(node, titles = []) {
    if (ts.isCallExpression(node) && ['test', 'test.describe'].includes(name(node.expression))) {
      const title = textLiteral(node.arguments[0]), callback = callbackOf(node)
      assert.ok(title && callback?.body, `Static test title/callback required: ${file}`)
      if (name(node.expression) === 'test.describe') { walk(callback.body, [...titles, title]); return }
      let count = 0
      visit(callback.body, child => { if (ts.isCallExpression(child) && ['expect', 'expect.poll'].includes(name(child.expression))) count++ })
      const steps = []
      visit(callback.body, child => { if (ts.isCallExpression(child) && name(child.expression) === 'test.step') steps.push(textLiteral(child.arguments[0])) })
      result.push({ titlePath: [...titles, title], minExpects: count, steps })
      return
    }
    ts.forEachChild(node, child => walk(child, titles))
  }
  walk(tree)
  return result
}

const locatorMethods = new Set(['goto', 'getByRole', 'getByText', 'getByLabel', 'getByTestId', 'getByPlaceholder', 'getByTitle', 'getByAltText', 'locator', 'filter', 'nth', 'first', 'last', 'click', 'fill', 'press', 'check', 'uncheck', 'selectOption', 'isVisible', 'textContent', 'innerText', 'count', 'getAttribute', 'url'])
const expectationMethods = new Set(['toHaveURL', 'toHaveText', 'toContainText', 'toHaveCount', 'toHaveAttribute', 'toBeVisible', 'toBeHidden', 'toBe', 'toEqual', 'toContain', 'toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeUndefined', 'toMatch', 'toBeGreaterThan', 'toBeLessThan'])
const testMethods = new Set(['describe', 'step', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const reservedBindings = new Set(['page', 'test', 'expect'])

function fixtureCallback(callback, { required = false } = {}) {
  assert.ok(ts.isArrowFunction(callback), 'Only direct arrow callbacks are permitted')
  assert.ok(callback.body, 'Test callback body required')
  if (!callback.parameters.length) { assert.ok(!required, 'Playwright fixture callback required'); return }
  assert.equal(callback.parameters.length, 1, 'Only the reviewed Playwright fixture parameter is permitted')
  const parameter = callback.parameters[0]
  assert.ok(!parameter.initializer && !parameter.questionToken && !parameter.dotDotDotToken, 'Defaulted, optional, or rest fixture parameter forbidden')
  const pattern = parameter.name
  assert.ok(ts.isObjectBindingPattern(pattern) && pattern.elements.length === 1, 'Exact { page } fixture binding required')
  const element = pattern.elements[0]
  assert.ok(ts.isIdentifier(element.name) && element.name.text === 'page' && !element.propertyName &&
    !element.dotDotDotToken && !element.initializer && !element.questionToken, 'Aliased or defaulted fixture binding forbidden')
}

export function checkOrdinarySource(file, source) {
  const tree = syntax(file, source)
  const locatorScopes = new Map()
  const approvedPageParameters = new WeakSet()
  const approvedPageBindings = new WeakSet()
  const hookCalls = new Set(['test.beforeEach', 'test.afterEach', 'test.beforeAll', 'test.afterAll'])
  const isScopedTestCall = node => ts.isCallExpression(node) && (name(node.expression) === 'test' || hookCalls.has(name(node.expression)))
  const testScope = node => {
    let current = node
    while (current && !isScopedTestCall(current)) current = current.parent
    return current
  }
  visit(tree, node => {
    if (!ts.isCallExpression(node)) return
    const path = name(node.expression)
    const callback = path === 'test' ? node.arguments[1] :
      hookCalls.has(path) ? node.arguments.at(-1) : undefined
    if (!callback) return
    fixtureCallback(callback, { required: path === 'test' })
    if (callback.parameters.length) {
      const parameter = callback.parameters[0]
      approvedPageParameters.add(parameter)
      approvedPageBindings.add(parameter.name.elements[0])
    }
  })
  visit(tree, node => {
    if (!isScopedTestCall(node)) return
    const callback = callbackOf(node)
    if (!callback?.body) return
    const locators = new Set(['page'])
    // Discover aliases within this test callback only. Names in another test
    // or at module scope cannot authorize Playwright-shaped calls here.
    let changed
    do {
      changed = false
      if (!ts.isBlock(callback.body)) continue
      for (const statement of callback.body.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const child of statement.declarationList.declarations) {
          if (!ts.isIdentifier(child.name) || !child.initializer) continue
          const value = name(child.initializer), root = value.split('.')[0]
          if (ts.isCallExpression(child.initializer) && locators.has(root) && value.split('.').slice(1).every(part => locatorMethods.has(part)) && !locators.has(child.name.text)) { locators.add(child.name.text); changed = true }
        }
      }
    } while (changed)
    for (const locator of locators) {
      if (locator === 'page') continue
      const bindings = []
      visit(callback.body, child => {
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === locator) bindings.push(child)
        else if (ts.isParameter(child) && ts.isIdentifier(child.name) && child.name.text === locator) bindings.push(child)
        else if (ts.isFunctionDeclaration(child) && child.name?.text === locator) bindings.push(child)
        else if (ts.isBindingElement(child) && ts.isIdentifier(child.name) && child.name.text === locator) bindings.push(child)
      })
      assert.equal(bindings.length, 1, `Locator alias must have one binding per test callback: ${locator}`)
      const binding = bindings[0]
      assert.ok(ts.isVariableDeclaration(binding) && ts.isIdentifier(binding.name) && binding.initializer &&
        ts.isCallExpression(binding.initializer), `Locator alias binding must be a static locator: ${locator}`)
    }
    locatorScopes.set(node, locators)
  })
  // No same-named binding elsewhere may borrow an alias's allowlisted methods.
  for (const [scope, locators] of locatorScopes) {
    const callback = callbackOf(scope)
    for (const locator of locators) {
      if (locator === 'page') continue
      visit(tree, node => {
        const bindingName = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
          ? node.name : ts.isBindingElement(node) ? node.name : undefined
        if (!bindingName || !ts.isIdentifier(bindingName) || bindingName.text !== locator) return
        assert.ok(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer), `Untrusted locator-name binding: ${locator}`)
        const owner = testScope(node)
        const ownerCallback = owner && callbackOf(owner)
        assert.ok(ownerCallback && ts.isBlock(ownerCallback.body) && node.parent.parent.parent === ownerCallback.body && locatorScopes.get(owner)?.has(locator), `Locator alias must be a direct test-body binding: ${locator}`)
        if (owner === scope) assert.equal(callback, ownerCallback)
      })
    }
  }
  let fixtureImports = 0
  visit(tree, node => {
    if (ts.isImportDeclaration(node)) {
      assert.equal(textLiteral(node.moduleSpecifier), './fixtures/dashboard', `Unapproved import: ${file}`)
      assert.ok(node.importClause && !node.importClause.name && ts.isNamedImports(node.importClause.namedBindings), 'Exact named imports required')
      const names = node.importClause.namedBindings.elements
      assert.deepEqual(names.map(item => item.name.text).sort(), ['expect', 'test'])
      assert.ok(names.every(item => !item.propertyName && !item.isTypeOnly), 'Import aliases forbidden')
      fixtureImports++
    }
    if (ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node) || ts.isElementAccessExpression(node) || ts.isDeleteExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isFunctionExpression(node) || ts.isWithStatement(node) || ts.isModuleDeclaration(node) || ts.isEnumDeclaration(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) throw new Error(`Execution escape: ${file}`)
    if (ts.isIdentifier(node) && ['eval', 'Function', 'process', 'require', 'globalThis', 'window', 'document', 'navigator', 'fetch', 'setTimeout', 'setInterval', 'WebSocket', 'Worker', 'Proxy', 'Reflect'].includes(node.text)) throw new Error(`Forbidden global ${node.text}: ${file}`)
    if (ts.isIdentifier(node) && ['constructor', 'prototype', '__proto__'].includes(node.text)) throw new Error(`Forbidden reflective identifier ${node.text}: ${file}`)
    if (ts.isPropertyAccessExpression(node) && ['constructor', 'prototype', '__proto__'].includes(node.name.text)) throw new Error(`Forbidden reflective property ${node.name.text}: ${file}`)
    if (ts.isCatchClause(node)) throw new Error(`Error swallowing forbidden: ${file}`)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) throw new Error(`Assignment forbidden: ${file}`)
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) throw new Error(`Mutation forbidden: ${file}`)
    if (ts.isVariableDeclaration(node) && node.initializer && (name(node.initializer).startsWith('expect') || name(node.initializer).startsWith('test'))) throw new Error(`API alias forbidden: ${file}`)
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && ts.isIdentifier(node.name) && reservedBindings.has(node.name.text)) {
      const allowedPage = node.name.text === 'page' && ts.isParameter(node) && approvedPageParameters.has(node)
      if (!allowedPage) throw new Error(`Fixture/API shadowing forbidden: ${file}`)
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && reservedBindings.has(node.name.text)) {
      const allowedPage = node.name.text === 'page' && approvedPageBindings.has(node) && !node.propertyName && !node.initializer
      if (!allowedPage) throw new Error(`Fixture/API shadowing forbidden: ${file}`)
    }
    if (ts.isBindingElement(node) && node.propertyName) throw new Error(`Destructuring alias forbidden: ${file}`)
    if (ts.isCallExpression(node)) {
      const path = name(node.expression), parts = path.split('.'), root = parts[0]
      const locators = locatorScopes.get(testScope(node))
      if (ts.isCallExpression(node.expression)) throw new Error(`Calling a value returned by another call is forbidden: ${file}`)
      if (path === 'test') fixtureCallback(node.arguments[1], { required: true })
      else if (path === 'test.describe') {
        assert.equal(node.arguments.length, 2, 'Exact describe signature required')
        fixtureCallback(node.arguments[1])
        assert.equal(node.arguments[1].parameters.length, 0, 'Describe callback must not bind fixtures')
      } else if (path === 'test.step') {
        assert.equal(node.arguments.length, 2, 'Exact step signature required')
        fixtureCallback(node.arguments[1])
        assert.equal(node.arguments[1].parameters.length, 0, 'Step callback must not shadow fixtures')
      } else if (['test.beforeEach', 'test.afterEach', 'test.beforeAll', 'test.afterAll'].includes(path)) {
        fixtureCallback(node.arguments.at(-1))
      }
      if (path === 'test' || path === 'expect' || path === 'expect.poll') return
      if (root === 'test' && parts.length === 2 && testMethods.has(parts[1])) return
      if (root === 'expect' && parts.slice(1).every(part => part === 'poll' || part === 'not' || expectationMethods.has(part))) return
      if (locators?.has(root) && parts.length > 1 && parts.slice(1).every(part => locatorMethods.has(part))) {
        if (parts.at(-1) === 'goto') assert.ok(/^\/(?!\/)/.test(textLiteral(node.arguments[0]) ?? ''), 'Only static fixture-relative navigation permitted')
        return
      }
      throw new Error(`Unapproved call ${node.expression.getText(tree)}: ${file}`)
    }
    if (ts.isPropertyAccessExpression(node)) {
      const path = name(node)
      if (/^(test|expect)\./.test(path)) {
        const segments = path.split('.').slice(1)
        assert.ok(segments.every(part => testMethods.has(part) || part === 'poll' || part === 'not' || expectationMethods.has(part)), `Unapproved test/expect API: ${path}`)
      }
    }
  })
  assert.equal(fixtureImports, 1, `Exactly one production fixture import: ${file}`)
  return declarations(file, source)
}

/** Reserved Stage 4 checker: this does not introduce or accept absent WebMCP tests. */
export function checkReadOnlyEvaluation(source) {
  const tree = syntax('read-only-evaluation.ts', source)
  const allowed = new Set(['document.modelContext.getTools', 'document.modelContext.executeTool', 'document.querySelector', 'document.querySelectorAll', 'localStorage.getItem', 'localStorage.key', 'sessionStorage.getItem', 'sessionStorage.key', 'JSON.stringify', 'JSON.parse', 'Object.keys', 'Object.entries', 'Array.from'])
  visit(tree, node => {
    if (ts.isNewExpression(node) || ts.isElementAccessExpression(node) || ts.isDeleteExpression(node) || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isTaggedTemplateExpression(node)) throw new Error('WebMCP evaluation escape')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) throw new Error('WebMCP evaluation mutation')
    if (ts.isCallExpression(node) && !allowed.has(name(node.expression))) throw new Error(`Unapproved read-only operation: ${name(node.expression)}`)
    if (ts.isIdentifier(node) && ['fetch', 'eval', 'Function', 'process', 'require', 'setTimeout', 'setInterval'].includes(node.text)) throw new Error('WebMCP evaluation global escape')
  })
  return true
}

export function checkConfiguration(source, packageValue, workflow) {
  const tree = syntax('playwright.config.ts', source)
  const exported = tree.statements.find(node => ts.isExportAssignment(node))
  assert.ok(exported && ts.isCallExpression(exported.expression) && name(exported.expression.expression) === 'defineConfig', 'Static defineConfig required')
  const config = exported.expression.arguments[0]
  assert.ok(ts.isObjectLiteralExpression(config), 'Static configuration object required')
  assert.ok(config.properties.every(node => ts.isPropertyAssignment(node)), 'Configuration spread/method forbidden')
  assert.ok(!config.properties.some(node => node.name.getText(tree) === 'testIgnore'), 'Global test exclusion forbidden')
  const projectNode = config.properties.find(node => node.name.getText(tree) === 'projects')?.initializer
  assert.ok(projectNode && ts.isArrayLiteralExpression(projectNode), 'Explicit projects required')
  assert.deepEqual(projectNode.elements.map(node => {
    assert.ok(ts.isObjectLiteralExpression(node) && node.properties.every(prop => ts.isPropertyAssignment(prop)), 'Static project configuration required')
    const prop = node.properties.find(prop => prop.name.getText(tree) === 'name')
    return textLiteral(prop?.initializer)
  }).sort(), [...projects].sort(), 'Exact project configuration')
  const required = new Map([['retries', '0'], ['workers', '1'], ['forbidOnly', 'true'], ['fullyParallel', 'false'], ['reuseExistingServer', 'false'], ['chromiumSandbox', 'true']])
  const seen = new Set()
  visit(tree, node => {
    if (ts.isPropertyAssignment(node) && required.has(node.name.getText(tree))) {
      const key = node.name.getText(tree)
      assert.equal(node.initializer.getText(tree), required.get(key), `Unsafe configuration ${key}`)
      seen.add(key)
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'testIgnore') assert.ok(!ts.isSourceFile(node.parent.parent), 'Project-only test exclusions')
  })
  for (const key of required.keys()) assert.ok(seen.has(key), `Missing configuration ${key}`)
  assert.ok(source.includes("channel: 'chromium'"))
  assert.ok(source.includes('--strictPort') || packageValue.scripts.preview.includes('--strictPort'))
  assert.ok(!/continue-on-error\s*:\s*(?:true|\$\{)/.test(workflow), 'Workflow bypass')
  assert.ok(!/pull_request_target\s*:/.test(workflow), 'Privileged workflow')
  assert.ok(!/(?:\|\|\s*(?:true|echo)|--pass-with-no-tests|continue-on-error\s*:\s*["']?true)/.test(workflow), 'Workflow swallowed failure')
  // Required checks cannot be conditionally skipped; the artifact upload's always() is the only reviewed condition.
  const conditions = workflow.split('\n').filter(line => /^\s*if\s*:/.test(line))
  assert.ok(conditions.every(line => /^\s{8}if:\s*always\(\)\s*$/.test(line)), 'Conditional verification bypass')
  for (const job of ['python-contracts-and-eval:', 'frontend-e2e:']) assert.equal(workflow.split('\n').filter(line => line === `  ${job}`).length, 1, `Missing/duplicate workflow job ${job}`)
  const runLines = []
  let inRun = false
  for (const line of workflow.split('\n')) {
    const inline = line.match(/^ {8}run:\s*(.*)$/)
    if (inline) { inRun = /^[|>]/.test(inline[1]); if (!inRun) runLines.push(inline[1]); continue }
    if (inRun && /^ {10}\S/.test(line)) runLines.push(line.trim())
    else if (line.trim() && !/^ {10}/.test(line)) inRun = false
  }
  for (const command of ['backend.ingestion.test_importer backend.gate.test_gate', 'backend.investigator.test_investigator backend.investigator.test_retrieval', 'unittest discover -s evaluators -p test_evaluate.py', 'tests/test_vertical_slice.py', 'frontend/scripts/export_mixed.py --check', 'frontend/scripts/export_showcase.py --check', 'harness/run_pr_verification.mjs']) assert.ok(runLines.some(line => /^(?:python|node)\s/.test(line) && line.includes(command)), `Missing workflow command ${command}`)
  for (const [key, expected] of Object.entries({ pw: 'playwright', typecheck: 'tsc --noEmit', 'test:e2e': 'playwright test --project=chromium', 'test:guard': 'node scripts/test_guard_fixture.mjs --report artifacts/guard/report.json', 'test:webmcp-lifecycle': 'node scripts/test_webmcp_lifecycle.mjs --report artifacts/webmcp-lifecycle/report.json', build: 'tsc --noEmit && vite build --base=./', 'check:hygiene': 'node scripts/check_test_hygiene.mjs', 'test:hygiene': 'node --test scripts/check_test_hygiene.test.mjs', 'test:canary': 'node scripts/check_canary_regression.mjs' })) assert.equal(packageValue.scripts[key], expected, `Changed required script ${key}`)
  assert.ok(!/(?:\|\|\s*(?:true|echo)|--pass-with-no-tests|--retries[= ]+[1-9])/.test(JSON.stringify(packageValue.scripts)), 'Package bypass')
  return true
}

export async function scanTree(root = frontendRoot, suppliedInventory) {
  root = await realpath(root)
  const inventory = readInventory(suppliedInventory ?? JSON.parse(await readFile(join(root, 'tests/expected-tests.json'), 'utf8')))
  const approvedSpecs = new Set(Object.values(inventory.projects).flatMap(project => project.tests.map(entry => entry.file)))
  const allowed = new Set([...approvedSpecs, ...protectedFiles, 'tests/expected-tests.json'])
  const seen = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), rel = relative(root, path).split(sep).join('/')
      const stat = await lstat(path)
      assert.ok(!stat.isSymbolicLink(), `Symlink forbidden: ${rel}`)
      if (stat.isDirectory()) { await walk(path); continue }
      assert.ok(stat.isFile(), `Special file forbidden: ${rel}`)
      assert.ok(allowed.has(rel), `Unapproved test/helper file: ${rel}`)
      seen.push(rel)
      if (!rel.endsWith('.ts')) continue
      assert.ok(rel.endsWith('.spec.ts') || rel === 'tests/fixtures/dashboard.ts', `Unapproved test-like extension: ${rel}`)
      const bytes = await readFile(path), source = bytes.toString('utf8')
      if (protectedFiles.includes(rel)) {
        assert.equal(digest(bytes), inventory.protectedSources[rel], `Protected fixture/meta source changed: ${rel}`)
      } else {
        assert.ok(ordinaryFiles.includes(rel), `Unreviewed source category: ${rel}`)
        checkOrdinarySource(rel, source)
      }
      const actual = declarations(rel, source)
      const expected = Object.values(inventory.projects).flatMap(project => project.tests).filter(entry => entry.file === rel)
      assert.equal(actual.length, expected.length, `Declaration count: ${rel}`)
      for (const entry of expected) {
        const found = actual.find(item => JSON.stringify(item.titlePath) === JSON.stringify(entry.titlePath))
        assert.ok(found, `Unknown/missing test identity: ${entry.id}`)
        assert.ok(found.minExpects >= entry.minExpects, `Assertion minimum: ${entry.id} (${found.minExpects}/${entry.minExpects})`)
        if (entry.stepId) assert.equal(found.steps.filter(step => step === entry.stepId).length, 1, `Named step: ${entry.id}`)
      }
    }
  }
  await walk(join(root, 'tests'))
  for (const file of allowed) assert.ok(seen.includes(file), `Missing approved source ${file}`)
  const configNames = (await readdir(root)).filter(file => /^playwright\.config\./.test(file))
  assert.deepEqual(configNames, ['playwright.config.ts'], 'Exactly one Playwright configuration')
  checkConfiguration(await readFile(join(root, 'playwright.config.ts'), 'utf8'), JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), await readFile(join(root, '../.github/workflows/ci.yml'), 'utf8'))
  return { files: seen.sort(), inventory }
}

export async function validateReport(report, project, inventory, execution = false) {
  const contract = inventory.projects[project]
  assert.ok(contract && contract.state === 'active', `BLOCKED: project ${project} not introduced`)
  assert.deepEqual(report.errors ?? [], [], 'Runner-level failure')
  const expected = contract.tests, rows = reportTests(report)
  const keys = new Set()
  assert.equal(rows.length, expected.length, 'Exact report count')
  for (const row of rows) {
    assert.equal(row.titlePath[0], row.file, 'Exact report file suite')
    const key = identity({ project: row.projectName, file: `tests/${row.file}`, titlePath: row.titlePath.slice(1) })
    assert.ok(!keys.has(key), 'Duplicate report identity'); keys.add(key)
    const entry = expected.find(item => identity(item) === key)
    assert.ok(entry, `Unexpected discovered identity: ${key}`)
    assert.equal(row.expectedStatus, 'passed')
    if (!execution) { assert.equal(row.results.length, 0); continue }
    assert.equal(row.results.length, 1, 'Exactly one result')
    const result = row.results[0], negative = entry.guardReason
    assert.equal(result.retry, 0, 'Retry forbidden')
    assert.equal(result.status, negative ? 'failed' : 'passed')
    assert.equal(row.status, negative ? 'unexpected' : 'expected')
    const diagnostic = result.attachments?.find(item => item.name === 'guard-diagnostics')
    assert.ok(diagnostic && typeof diagnostic.body === 'string' && diagnostic.body.length < 8192, 'Bounded inline guard diagnostics required')
    const diagnosticCodes = JSON.parse(Buffer.from(diagnostic.body, 'base64')).codes
    assert.ok(Array.isArray(diagnosticCodes), 'Guard codes array required')
    if (negative) {
      assert.ok(result.errors?.length && result.errors.every(error => error.message?.includes('DASHBOARD_GUARD')), 'Guard-only failure required')
      const attachment = result.attachments?.find(item => item.name === 'guard-diagnostics')
      assert.ok(attachment, 'Guard diagnostics missing')
      assert.ok(typeof attachment.body === 'string' && attachment.body.length < 8192, 'Bounded inline guard diagnostics required')
      const bytes = Buffer.from(attachment.body, 'base64')
      const codes = JSON.parse(bytes).codes
      assert.ok(codes.includes(negative), 'Wrong guard attribution')
      const allowed = [negative, ...(['HTTP_404', 'HTTP_500', 'REQUEST_FAILED'].includes(negative) ? ['CONSOLE_ERROR'] : [])]
      assert.ok(codes.every(code => allowed.includes(code)), 'Unrelated guard failure')
    } else { assert.deepEqual(result.errors ?? [], [], 'Unrelated execution error'); assert.deepEqual(diagnosticCodes, [], 'Clean production guard required') }
  }
  return rows.length
}

export async function main(args = process.argv.slice(2)) {
  const projectArg = args.find(arg => arg.startsWith('--project='))
  assert.ok(projectArg, '--project=<name> required')
  const project = projectArg.slice('--project='.length)
  assert.ok(projects.includes(project), 'Unknown project')
  const reportIndex = args.indexOf('--report'), executionPath = reportIndex < 0 ? undefined : resolve(frontendRoot, args[reportIndex + 1] ?? '')
  assert.ok(args.every((arg, index) => arg === projectArg || arg === '--report' || (reportIndex >= 0 && index === reportIndex + 1)), 'Unknown arguments')
  if (reportIndex >= 0) assert.ok(args[reportIndex + 1], '--report requires path')
  const evidence = process.env.PW_HYGIENE_OUTPUT_DIR ? resolve(process.env.PW_HYGIENE_OUTPUT_DIR) : await mkdtemp(join(tmpdir(), 'qualityops-hygiene-'))
  const discoveryName = `${project}-discovery.json`, executionName = `${project}-report.json`
  const discoveryPath = join(evidence, discoveryName)
  await rm(discoveryPath, { force: true })
  const command = ['node_modules/@playwright/test/cli.js', 'test', `--project=${project}`, '--list', '--reporter=json']
  const record = { schema_version: 'hygiene-1', result: 'FAIL', project, command, cwd: frontendRoot,
    source_bytes: 'observed-candidate', source_sha256: {},
    verifier_revision: process.env.PW_VERIFIER_REVISION ?? null,
    discovery: discoveryName, execution: executionPath ? executionName : null }
  try {
    const { files, inventory } = await scanTree()
    record.files = files
    for (const file of files) record.source_sha256[file] = digest(await readFile(join(frontendRoot, file)))
    record.inventory_sha256 = digest(await readFile(join(frontendRoot, 'tests/expected-tests.json')))
    record.policy_sha256 = digest(await readFile(join(frontendRoot, '../harness/pr-verification-policy.json')))
    assert.equal(inventory.projects[project].state, 'active', `BLOCKED: ${project} is NOT INTRODUCED; pending Stage 4`)
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, PLAYWRIGHT_JSON_OUTPUT_FILE: discoveryPath }
    assert.equal(await realpath(process.cwd()), await realpath(frontendRoot), 'Run hygiene from frontend working directory')
    record.child = await run(command, env)
    assert.equal(record.child.exit_code, 0, 'Discovery failed')
    assert.equal(record.child.timedOut, false)
    record.discovery_sha256 = digest(await readFile(discoveryPath))
    record.discovered = await validateReport(JSON.parse(await readFile(discoveryPath, 'utf8')), project, inventory)
    if (executionPath) {
      const destination = join(evidence, executionName)
      if (resolve(executionPath) !== resolve(destination)) await cp(executionPath, destination)
      record.execution_sha256 = digest(await readFile(destination))
      record.executed = await validateReport(JSON.parse(await readFile(destination, 'utf8')), project, inventory, true)
    }
    record.result = 'PASS'
  } catch (error) { record.reason = String(error).slice(0, 2000) }
  await save(join(evidence, `${project}-hygiene.json`), record)
  console.log(JSON.stringify({ result: record.result, evidence }))
  return record.result === 'PASS' ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code }).catch(error => { console.error(String(error)); process.exitCode = 1 })
