import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceRevisionFor } from './check_hygiene_report.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifier = process.env.PW_VERIFIER_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const candidate = JSON.parse(readFileSync(path.join(root, 'harness/pr-verification-policy.json'))).source_revision
const blob = (revision, file) => execFileSync('git', ['show', `${revision}:${file}`], { cwd: root })

test('guard and lifecycle hygiene bind ordinary-spec hashes to a differing candidate overlay', () => {
  const file = 'tests/mixed-campaign.spec.ts'
  const verifierBytes = blob(verifier, `frontend/${file}`)
  const candidateBytes = blob(candidate, `frontend/${file}`)
  assert.notDeepEqual(candidateBytes, verifierBytes, 'fixture must represent a real ordinary-spec revision difference')
  for (const project of ['chromium', 'chromium-guard-meta', 'chromium-webmcp-lifecycle', 'chromium-webmcp']) {
    assert.equal(sourceRevisionFor(project, file, verifier, candidate), candidate)
    assert.equal(sourceRevisionFor(project, 'tests/fixtures/dashboard.ts', verifier, candidate), verifier)
  }
})

test('active WebMCP project binds candidate ordinary overlays and verifier-owned interface spec', () => {
  assert.equal(sourceRevisionFor('chromium-webmcp', 'tests/mixed-campaign.spec.ts', verifier, candidate), candidate)
  assert.equal(sourceRevisionFor('chromium-webmcp', 'tests/webmcp.spec.ts', verifier, candidate), verifier)
})
