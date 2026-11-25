import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runner = join(root, 'harness/verify_red_team_matrix.mjs')

test('local red-team matrix passes all thirteen cases and leaves remote cases NOT RUN', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'qualityops-red-team-test-'))
  const output = join(parent, 'run')
  t.after(() => rm(parent, { recursive: true, force: true }))
  const stdout = execFileSync('node', [runner, '--local', '--output', output], { cwd: root, encoding: 'utf8' })
  assert.match(stdout, /"result":"PASS"/)
  const report = JSON.parse(await readFile(join(output, 'publication/red-team-summary.json'), 'utf8'))
  assert.equal(report.result, 'PASS')
  assert.equal(report.local_scenarios.length, 13)
  assert.ok(report.local_scenarios.every(row => row.status === 'PASS'))
  assert.ok(report.local_scenarios.every(row => row.workspace_cleanup === 'PASS'))
  assert.deepEqual(report.remote_scenarios.map(row => [row.id, row.status]), [['R12', 'NOT RUN'], ['R14', 'NOT RUN']])
  assert.equal(report.candidate_revision, report.verifier_revision)
})

test('red-team runner refuses remote and stale-output modes', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'qualityops-red-team-negative-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const remote = spawnSync('node', [runner, '--remote', '--output', join(parent, 'remote')], { cwd: root, encoding: 'utf8' })
  assert.equal(remote.status, 2)
  const missingOutput = spawnSync('node', [runner, '--local', '--output'], { cwd: root, encoding: 'utf8' })
  assert.equal(missingOutput.status, 2)
  const stale = join(parent, 'stale'); await (await import('node:fs/promises')).mkdir(stale)
  const reused = spawnSync('node', [runner, '--local', '--output', stale], { cwd: root, encoding: 'utf8' })
  assert.equal(reused.status, 2)
})
