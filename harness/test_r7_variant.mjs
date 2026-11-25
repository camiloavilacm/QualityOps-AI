import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareVariant } from './prepare_r7_variant.mjs'

test('R7 preparation changes only one compiled campaign title in a disposable copy', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-r7-variant-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const source = join(temp, 'source'), target = join(temp, 'variant')
  await mkdir(source)
  await writeFile(join(source, 'app.js'), 'const card="Mixed campaign"; const id="fixture-mixed";')
  await writeFile(join(source, 'style.css'), '.card { display: block }')
  const before = await readFile(join(source, 'app.js'), 'utf8')
  const record = await prepareVariant(source, target)
  assert.deepEqual(record, { result: 'PASS', changed_asset_count: 1, changed_field: 'campaign card title', value: 'Fixture campaign' })
  assert.equal(await readFile(join(source, 'app.js'), 'utf8'), before)
  assert.equal(await readFile(join(target, 'app.js'), 'utf8'), 'const card="Fixture campaign"; const id="fixture-mixed";')
  assert.equal(await readFile(join(target, 'style.css'), 'utf8'), '.card { display: block }')
})

test('R7 preparation rejects ambiguous compiled titles', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'qualityops-r7-negative-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const source = join(temp, 'source')
  await mkdir(source)
  await writeFile(join(source, 'app.js'), '"Mixed campaign"; "Mixed campaign";')
  await assert.rejects(prepareVariant(source, join(temp, 'variant')), /must rename exactly one/)
})
