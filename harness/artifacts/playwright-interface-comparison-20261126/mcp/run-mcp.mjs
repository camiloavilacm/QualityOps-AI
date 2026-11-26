import { writeFile } from 'node:fs/promises'
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
const transcript = { server: null, initialToolNames: [], calls: [] }
const record = async (name, args) => {
  const result = await client.callTool({ name, arguments: args })
  transcript.calls.push({ name, arguments: args, result })
  return result
}
await client.connect(transport)
try {
  transcript.server = await client.getServerVersion()
  transcript.initialToolNames = (await client.listTools()).tools.map(tool => tool.name)
  await record('browser_navigate', { url: 'http://127.0.0.1:4183/' })
  const home = await record('browser_snapshot', {})
  const homeText = (home.content ?? []).map(item => item.text ?? '').join('\n')
  if (!homeText.includes('fixture-mixed') || !homeText.includes('Mixed campaign')) throw new Error('MCP home snapshot did not expose the mixed campaign')
  await record('browser_click', { element: 'the Mixed campaign link for fixture-mixed', target: 'a.campaign-card[href="?campaign=fixture-mixed"]' })
  const detail = await record('browser_snapshot', {})
  const detailText = (detail.content ?? []).map(item => item.text ?? '').join('\n')
  if (!detailText.includes('BLOCKED') || !detailText.includes('REQUIRED_FAILURE') || !detailText.includes('INSUFFICIENT_EVIDENCE')) throw new Error('MCP detail snapshot did not show BLOCKED and both reason codes')
  const observed = await record('browser_evaluate', {
    function: '() => JSON.stringify({ url: location.href, decision: document.querySelector(".decision-value")?.textContent?.trim(), reasons: [...document.querySelectorAll(".reason-list > li")].map(li => ({ label: li.querySelector(".reason-main h3")?.textContent?.trim(), execution_id: li.querySelector(".reason-main p code")?.textContent?.trim(), code: li.querySelector(".reason-evidence > code")?.textContent?.trim() })) })'
  })
  const observedText = (observed.content ?? []).map(item => item.text ?? '').join('\n')
  if (!observedText.includes('fixture-mixed') || !observedText.includes('BLOCKED')) throw new Error('MCP evaluate response did not verify URL and decision')
  const afterPageTools = (await client.listTools()).tools.map(tool => tool.name)
  transcript.pageWebMCPTools = afterPageTools.filter(name => name.includes('campaign_summary') || name.includes('evaluation_summary'))
  if (!transcript.pageWebMCPTools.includes('webmcp_get_campaign_summary')) throw new Error('MCP server did not discover the page campaign summary tool')
  const validTool = await record('webmcp_get_campaign_summary', { campaign_id: 'fixture-mixed' })
  const validToolText = (validTool.content ?? []).map(item => item.text ?? '').join('\n')
  if (!validToolText.includes('BLOCKED') || !validToolText.includes('REQUIRED_FAILURE') || !validToolText.includes('INSUFFICIENT_EVIDENCE')) throw new Error('WebMCP valid call omitted the recorded gate reasons')
  const invalidTool = await record('webmcp_get_campaign_summary', { campaign_id: 'unknown-campaign' })
  transcript.validWebMCP = validToolText
  transcript.invalidWebMCP = invalidTool
  if (!invalidTool.isError) throw new Error('WebMCP invalid campaign was not rejected')
  await record('browser_close', {})
  await writeFile(`${root}/transcript.json`, JSON.stringify(transcript, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ result: 'PASS', server: transcript.server, initial_tool_count: transcript.initialToolNames.length, page_webmcp_tools: transcript.pageWebMCPTools, calls: transcript.calls.map(call => call.name), observed: observedText }, null, 2) + '\n')
} finally {
  await client.close()
  await transport.close()
}
