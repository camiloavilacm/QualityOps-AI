import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mutateExport } from './canary_mutation.mjs'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.argv[2] || path.join(frontend, '..', 'canary-variants'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const safeEnv = { PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: os.tmpdir(), TMPDIR: os.tmpdir(), CI: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }

async function hashes(directory) {
  const found = {}
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name)
      assert.ok(!entry.isSymbolicLink(), 'Prepared bundle may not contain symlinks')
      if (entry.isDirectory()) await walk(item)
      else { assert.ok(entry.isFile()); found[path.relative(directory, item).split(path.sep).join('/')] = sha(await fs.readFile(item)) }
    }
  }
  await walk(directory)
  assert.ok(Object.keys(found).some(name => name.endsWith('.js')), 'Prepared bundle is missing JavaScript')
  return found
}

function command(argv, cwd) {
  const started = Date.now()
  const result = spawnSync(process.execPath, argv, { cwd, env: safeEnv, encoding: 'utf8', timeout: 300_000, maxBuffer: 2 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`trusted canary preparation command failed (${path.basename(argv[0])})`)
  return { command: [process.execPath, path.relative(frontend, argv[0]), ...argv.slice(1)],
    cwd: 'isolated verifier-source copy', exit_code: 0, timedOut: false, duration_ms: Date.now() - started }
}

async function makeReadOnly(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) { await makeReadOnly(child); await fs.chmod(child, 0o555) }
    else await fs.chmod(child, 0o444)
  }
  await fs.chmod(directory, 0o555)
}

export async function prepareCanaryBundles({ root = frontend, destination = output, verifierRevision = process.env.PW_VERIFIER_REVISION }) {
  assert.match(verifierRevision || '', /^[0-9a-f]{40}$/, 'Full verifier revision required')
  root = await fs.realpath(root)
  assert.ok(destination.startsWith(path.dirname(root) + path.sep), 'Output must remain under the trusted application parent')
  const inventoryBytes = await fs.readFile(path.join(root, 'tests/expected-tests.json'))
  const lockBytes = await fs.readFile(path.join(root, 'package-lock.json'))
  const exportBytes = await fs.readFile(path.join(root, 'src/showcase-export.json'))
  const original = JSON.parse(exportBytes), { mutated, removedReason } = mutateExport(original)
  const mutatedBytes = Buffer.from(JSON.stringify(mutated, null, 2) + '\n')
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'qualityops-canary-build-'))
  await fs.rm(destination, { recursive: true, force: true })
  await fs.mkdir(destination, { recursive: true })
  const variants = {}
  try {
    for (const [name, bytes] of [['positive', exportBytes], ['mutated', mutatedBytes]]) {
      const workspace = path.join(temp, name)
      await fs.mkdir(workspace)
      for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts', 'index.html', 'src', 'tests', 'types'])
        await fs.cp(path.join(root, file), path.join(workspace, file), { recursive: true })
      await fs.symlink(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir')
      await fs.writeFile(path.join(workspace, 'src/showcase-export.json'), bytes)
      const buildCommands = []
      buildCommands.push(command([path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], workspace))
      buildCommands.push(command([path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--base=./'], workspace))
      const target = path.join(destination, name)
      await fs.rename(path.join(workspace, 'dist'), target)
      variants[name] = { export_sha256: sha(bytes), bundle_sha256: await hashes(target), commands: buildCommands }
    }
    await fs.writeFile(path.join(destination, 'mutated-export.json'), mutatedBytes)
    const manifest = { schema_version: 'canary-build-1', source_revision: verifierRevision,
      inventory_sha256: sha(inventoryBytes), lockfile_sha256: sha(lockBytes),
      original_export_sha256: sha(exportBytes), mutated_export_sha256: sha(mutatedBytes),
      spec_sha256: sha(await fs.readFile(path.join(root, 'tests/mixed-campaign.spec.ts'))),
      mutation: { campaign_id: 'fixture-mixed', removed_reason: removedReason, removed_count: 1, exact_delta: true },
      variants, temporary_copies: 'PASS' }
    await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    for (const name of ['positive', 'mutated']) await makeReadOnly(path.join(destination, name))
    await fs.chmod(path.join(destination, 'mutated-export.json'), 0o444)
    await fs.chmod(path.join(destination, 'manifest.json'), 0o444)
    await fs.chmod(destination, 0o555)
    return manifest
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareCanaryBundles({ destination: process.argv[2], verifierRevision: process.env.PW_VERIFIER_REVISION })
    .then(manifest => console.log(JSON.stringify({ result: 'PASS', schema_version: manifest.schema_version,
      positive_files: Object.keys(manifest.variants.positive.bundle_sha256).length,
      mutated_files: Object.keys(manifest.variants.mutated.bundle_sha256).length })))
    .catch(error => { console.error(JSON.stringify({ result: 'FAIL', reason: String(error).slice(0, 1000) })); process.exitCode = 1 })
}
