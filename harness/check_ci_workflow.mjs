import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateWorkflow(source, dependabot) {
  assert.match(source, /^name: Offline Verification CI$/m)
  assert.match(source, /^  pull_request:\s*$/m)
  assert.match(source, /^  push:\s*$/m)
  assert.match(source, /^permissions:\n  contents: read\s*$/m)
  assert.match(source, /^concurrency:\n  group: offline-.*\n  cancel-in-progress: true\s*$/m)
  assert.doesNotMatch(source, /^\s+paths(?:-ignore)?:/m, 'Verification triggers cannot filter paths')
  assert.doesNotMatch(source, /^\s+continue-on-error:\s*(?:true|\$\{)/m)
  assert.doesNotMatch(source, /^\s*pull_request_target\s*:/m, 'Privileged workflow trigger')
  assert.doesNotMatch(source, /(?:\|\|\s*(?:true|echo)|--pass-with-no-tests)/)
  const actionPins = [...source.matchAll(/^\s+uses:\s+[^\s@]+@([^\s#]+)(?:\s+#.*)?$/gm)]
  assert.ok(actionPins.length >= 4, 'Expected reviewed actions')
  assert.ok(actionPins.every(match => /^[0-9a-f]{40}$/.test(match[1])), 'Every action must use a full commit SHA')
  for (const action of ['actions/checkout@', 'actions/setup-python@', 'actions/setup-node@', 'actions/upload-artifact@'])
    assert.ok(source.includes(action), `Missing required action ${action}`)
  assert.equal((source.match(/^  python-contracts-and-eval:\s*$/gm) ?? []).length, 1)
  assert.equal((source.match(/^  frontend-e2e:\s*$/gm) ?? []).length, 1)
  assert.equal((source.match(/^  frontend-webmcp:\s*$/gm) ?? []).length, 1)
  assert.ok(source.includes('persist-credentials: false'), 'Checkout credentials must not persist')
  for (const command of [
    'python -B harness/checks.py contracts',
    'backend.ingestion.test_importer backend.gate.test_gate',
    'backend.investigator.test_investigator backend.investigator.test_retrieval',
    'unittest discover -s evaluators -p test_evaluate.py',
    'tests/test_vertical_slice.py',
    'frontend/scripts/export_mixed.py --check',
    'frontend/scripts/export_showcase.py --check',
  ]) assert.ok(source.includes(command), `Missing offline check: ${command}`)
  assert.match(source, /run_pr_verification\.mjs --bootstrap --stage 3/)
  assert.match(source, /run_pr_verification\.mjs --bootstrap --stage 4/)
  assert.match(source, /path: harness\/artifacts\/container-stage3\/publication\//)
  assert.match(source, /path: harness\/artifacts\/container-stage3\/publication\/container\/red-team\/publication\//)
  assert.match(source, /path: harness\/artifacts\/container-stage4\/publication\//)
  assert.match(source, /retention-days: 7/)
  assert.match(source, /if-no-files-found: error/)
  assert.match(dependabot, /^version: 2$/m)
  assert.match(dependabot, /package-ecosystem:\s*["']?github-actions["']?/)
  assert.match(dependabot, /schedule:\n\s+interval:\s*["']?weekly["']?/)
  return { result: 'PASS', action_count: actionPins.length }
}

async function main() {
  try {
    const result = validateWorkflow(await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
      await readFile(resolve(root, '.github/dependabot.yml'), 'utf8'))
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
