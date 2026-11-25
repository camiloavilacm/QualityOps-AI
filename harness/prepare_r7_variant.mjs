import assert from 'node:assert/strict'
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function prepareVariant(source, target) {
  source = resolve(source); target = resolve(target)
  const sourceInfo = await lstat(source)
  assert.ok(sourceInfo.isDirectory() && !sourceInfo.isSymbolicLink(), 'trusted baseline build directory required')
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: true, force: false })
  const changed = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name), info = await lstat(file)
      assert.ok(!info.isSymbolicLink(), 'variant bundle cannot contain symlinks')
      if (info.isDirectory()) await walk(file)
      else if (info.isFile() && entry.name.endsWith('.js')) {
        const before = await readFile(file, 'utf8')
        const occurrences = before.split('Mixed campaign').length - 1
        if (occurrences) {
          assert.equal(occurrences, 1, 'R7 variant must rename exactly one campaign card title')
          await writeFile(file, before.replace('Mixed campaign', 'Fixture campaign'))
          changed.push(file)
        }
      } else assert.ok(info.isFile(), 'variant bundle accepts regular files only')
    }
  }
  await walk(target)
  assert.equal(changed.length, 1, 'R7 variant must change one compiled UI asset')
  return { result: 'PASS', changed_asset_count: 1, changed_field: 'campaign card title', value: 'Fixture campaign' }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const [source, target] = process.argv.slice(2)
    assert.ok(source && target && process.argv.length === 4, 'source and target directories required')
    console.log(JSON.stringify(await prepareVariant(source, target)))
  } catch (error) {
    console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
    process.exitCode = 1
  }
}
