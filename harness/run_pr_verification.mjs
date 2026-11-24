// Stable interface; implementation uses only Python standard library on the host.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const result = spawnSync('python3', [fileURLToPath(new URL('./pr_verification.py', import.meta.url)),
  ...process.argv.slice(2)], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
