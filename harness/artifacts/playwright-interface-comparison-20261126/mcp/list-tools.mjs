import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const root = '/private/tmp/qualityops-interface-comparison-20261126/mcp'
const transport = new StdioClientTransport({
  command: `${root}/node_modules/.bin/playwright-mcp`,
  args: ['--config', `${root}/config.json`, '--headless', '--output-dir', `${root}/output`, '--save-session'],
  cwd: root,
  stderr: 'pipe',
})
const client = new Client({ name: 'qualityops-matched-interface-review', version: '1.0.0' }, { capabilities: {} })
await client.connect(transport)
try {
  const tools = await client.listTools()
  process.stdout.write(JSON.stringify({ server: await client.getServerVersion(), tools }, null, 2) + '\n')
} finally {
  await client.close()
  await transport.close()
}
