import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateWorkflow } from './check_ci_workflow.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const dependabot = await readFile(resolve(root, '.github/dependabot.yml'), 'utf8')

test('current offline workflow meets Stage 4 structure and pin policy', () => {
  assert.equal(validateWorkflow(workflow, dependabot).result, 'PASS')
})

for (const [label, mutate] of [
  ['mutable action tag', value => value.replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4')],
  ['path-filtered verification', value => value.replace('  pull_request:\n', '  pull_request:\n    paths: [frontend/**]\n')],
  ['failure suppression', value => value.replace('timeout-minutes: 35', 'timeout-minutes: 35\n    continue-on-error: true')],
  ['privileged pull request trigger', value => value.replace('  pull_request:\n', '  pull_request_target:\n')],
  ['missing Stage 3 gate', value => value.replace('--stage 3', '--stage 1')],
  ['red-team artifact outside trusted runner', value => value.replace('container-stage3/publication/container/red-team/publication/', 'red-team/publication/')],
  ['missing Stage 4 gate', value => value.replace('--stage 4', '--stage 3')],
]) test(`workflow policy rejects ${label}`, () => assert.throws(() => validateWorkflow(mutate(workflow), dependabot)))
