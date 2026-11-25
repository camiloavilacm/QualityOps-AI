import fs from 'node:fs'
import path from 'node:path'

const app = '/opt/qualityops/frontend'
const dist = path.join(app, 'dist')
const oracle = '/opt/qualityops/harness/oracles/authored-evaluation-v1.json'
const marker = 'qualityops-authored-evaluation-oracle-v1-do-not-bundle'
const maxBytes = 32 * 1024 * 1024

function inspect(directory) {
  const rootInfo = fs.lstatSync(directory)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('bundle scan root is not a regular directory')
  const pending = [directory]
  let total = 0, count = 0
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (++count > 4096) throw new Error('bundle file count exceeds the review bound')
      const file = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error('bundle contains a symbolic link')
      if (entry.isDirectory()) pending.push(file)
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(file)
        total += bytes.length
        if (total > maxBytes) throw new Error('bundle size exceeds the review bound')
        if (bytes.includes(Buffer.from(marker))) throw new Error('authored oracle marker appears in app source or bundle')
      } else throw new Error('bundle contains a non-regular entry')
    }
  }
  return { files: count, bytes: total }
}

try {
  if (fs.existsSync(oracle)) throw new Error('authored oracle was copied into the container app inputs')
  const source = inspect(path.join(app, 'src'))
  const bundle = inspect(dist)
  console.log(JSON.stringify({ result: 'PASS', oracle_input: 'ABSENT', source, bundle }))
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', reason: error.message }))
  process.exitCode = 1
}
