import { test, expect } from '../fixtures/dashboard'
import { createToolLifecycle, createDashboardTools, type RegistrationHost } from '../../src/webmcp'

const definitions: NativeToolDefinition[] = ['lifecycle_one', 'lifecycle_two'].map(name => ({ name, description: 'Lifecycle-only fixture', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false }, execute: () => ({}) }))
function mockHost(failSecond = false) {
  const names = new Set<string>()
  const host: RegistrationHost = {
    registerTool(tool, { signal }) {
      if (failSecond && tool.name === 'lifecycle_two') throw new Error('Deliberate second registration failure')
      names.add(tool.name)
      signal.addEventListener('abort', () => names.delete(tool.name), { once: true })
    },
  }
  return { host, names }
}

test('unsupported environment preserves dashboard', async ({ page }) => {
  const lifecycle = createToolLifecycle()
  expect(await lifecycle.initialize(undefined, definitions)).toBe(false)
  const [campaignTool, evaluationTool] = createDashboardTools()
  // Adapter omissions may normalize to {}; these assertions exercise the real handler boundary.
  for (const input of [undefined, null, [], 1, '{}', '{', { extra: true }]) {
    expect(await evaluationTool.execute(input)).toMatchObject({ isError: true })
  }
  expect(await evaluationTool.execute({})).toMatchObject({ isError: false })
  for (const input of [undefined, null, [], '{}', '{', {}, { campaign_id: 1 }, { campaign_id: 'fixture-pass' }, { campaign_id: 'fixture-mixed', extra: true }]) {
    expect(await campaignTool.execute(input)).toMatchObject({ isError: true })
  }
  expect(await campaignTool.execute({ campaign_id: 'fixture-mixed' })).toMatchObject({ isError: false })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  lifecycle.dispose()
})
test('duplicate initialization registers tools once', async () => {
  const { host, names } = mockHost()
  let calls = 0
  const counted: RegistrationHost = { registerTool(tool, options) { calls++; return host.registerTool(tool, options) } }
  const lifecycle = createToolLifecycle()
  expect(await Promise.all([lifecycle.initialize(counted, definitions), lifecycle.initialize(counted, definitions)])).toEqual([true, true])
  expect(calls).toBe(2)
  expect([...names]).toEqual(['lifecycle_one', 'lifecycle_two'])
  lifecycle.dispose()
})
test('second-registration failure rolls back first', async () => {
  const { host, names } = mockHost(true)
  const lifecycle = createToolLifecycle()
  expect(await lifecycle.initialize(host, definitions)).toBe(false)
  expect([...names]).toEqual([])
  const repaired = mockHost()
  expect(await lifecycle.initialize(repaired.host, definitions)).toBe(true)
  lifecycle.dispose()
  expect([...repaired.names]).toEqual([])
})
test('disposal unregisters tools and permits reinitialization', async () => {
  const { host, names } = mockHost()
  const lifecycle = createToolLifecycle()
  expect(await lifecycle.initialize(host, definitions)).toBe(true)
  lifecycle.dispose()
  expect([...names]).toEqual([])
  expect(await lifecycle.initialize(host, definitions)).toBe(true)
  expect([...names]).toEqual(['lifecycle_one', 'lifecycle_two'])
  lifecycle.dispose()
  expect([...names]).toEqual([])
})
