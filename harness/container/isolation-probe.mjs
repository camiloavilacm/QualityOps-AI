// Executed inside the same restrictions as tests, before any candidate code.
import fs from 'node:fs'
import net from 'node:net'
import http from 'node:http'
import os from 'node:os'
import { once } from 'node:events'

function demand(value, reason) { if (!value) throw new Error(reason) }
function deniedWrite(file) {
  try { fs.writeFileSync(file, 'probe', { flag: 'wx' }); fs.unlinkSync(file); throw new Error('source write permitted') }
  catch (error) { demand(['EROFS', 'EACCES', 'EPERM'].includes(error.code), 'write denial not established') }
}
export async function probe() {
  demand(process.platform === 'linux' && process.arch === 'x64', 'wrong platform')
  demand(process.getuid() > 0 && os.userInfo().username === 'pwuser', 'nonroot pwuser required')
  const status = fs.readFileSync('/proc/self/status', 'utf8')
  demand(/^CapEff:\s+0+$/m.test(status), 'effective capabilities present')
  demand(/^NoNewPrivs:\s+1$/m.test(status), 'no-new-privileges missing')
  demand(/^Seccomp:\s+2$/m.test(status), 'seccomp filter missing')
  deniedWrite('/opt/qualityops/frontend/.isolation-probe')
  deniedWrite('/opt/qualityops/frontend/tests/.isolation-probe')
  deniedWrite('/opt/qualityops/frontend/dist/.isolation-probe')
  for (const target of ['/var/run/docker.sock', '/run/docker.sock', '/root/.aws/credentials',
    '/home/pwuser/.aws/credentials', '/root/.ssh/id_rsa', '/home/pwuser/.ssh/id_rsa']) {
    try { fs.accessSync(target); throw new Error('protected resource accessible') }
    catch (error) { demand(['ENOENT', 'EACCES'].includes(error.code), 'protected resource accessible') }
  }
  demand(!Object.keys(process.env).some(key => /^(AWS_|GITHUB_TOKEN|GH_TOKEN|OPENAI_|ANTHROPIC_)/.test(key)),
    'credential environment present')
  const limits = {
    memory: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),
    pids: fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(),
    cpu: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
  }
  demand(limits.memory === '4294967296' && limits.pids === '512', 'resource limits differ')
  const [quota, period] = limits.cpu.split(' ').map(Number)
  demand(quota / period === 2, 'CPU limit differs')
  const shm = fs.statfsSync('/dev/shm')
  demand(shm.bsize * shm.blocks === 1073741824, 'private shared-memory size differs')
  for (const directory of ['/tmp', '/evidence']) {
    const file = `${directory}/.allowed-write-probe`
    fs.writeFileSync(file, 'permitted', { flag: 'wx' }); fs.unlinkSync(file)
  }
  const server = http.createServer((_request, response) => response.end('local-fixture'))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { signal: AbortSignal.timeout(2000) })
    demand(await response.text() === 'local-fixture', 'local fixture unavailable')
  } finally { await new Promise(resolve => server.close(resolve)) }
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '1.1.1.1', port: 443 })
    socket.setTimeout(2000)
    socket.once('connect', () => { socket.destroy(); reject(new Error('external connection permitted')) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('external denial was not immediate')) })
    socket.once('error', error => {
      socket.destroy()
      if (['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM'].includes(error.code)) resolve()
      else reject(new Error('unexpected external-connection result'))
    })
  })
  return { result: 'PASS', uid: process.getuid(), user: os.userInfo().username, limits, checks: ['temporary/evidence writes', 'loopback fixture',
    'read-only sources/tests/bundle', 'no capabilities', 'no new privileges', 'seccomp',
    'credential/socket absence', 'external connection denied'] }
}
