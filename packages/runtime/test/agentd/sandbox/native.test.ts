import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SandboxSpec } from '../../../src/agentd/sandbox/sandbox.ts'

const data = mkdtempSync(join(tmpdir(), 'native-'))
process.env.AGENTD_DATA = data
process.env.AGENTD_HERMES = join(data, 'runtime')
const { hostOf, layout, native, tree } = await import('../../../src/agentd/sandbox/native.ts')

const spec: SandboxSpec = {
  id: 'ag_test0001', image: 'x', cpus: 1, memoryMib: 1024, user: '1:1', entrypoint: '/opt/hermes/bin/hermes', command: ['gateway', 'run'], env: {}, labels: {}, tmpfs: [{ guest: '/tmp', sizeMib: 16 }],
  mounts: [
    { host: '/home/agent', guest: '/opt/data', readOnly: false },
    { host: '/home/agent/platforms', guest: '/opt/data/platforms', readOnly: false },
    { host: '/plugins', guest: '/opt/data/plugins', readOnly: true },
  ],
}

test('hostOf maps a guest path through the longest matching mount', () => {
  assert.equal(hostOf({ spec, guest: '/opt/data/home' }), '/home/agent/home')
  assert.equal(hostOf({ spec, guest: '/opt/data/plugins/x' }), '/plugins/x')
  assert.equal(hostOf({ spec, guest: '/opt/data' }), '/home/agent')
})

test('hostOf sends Hermes to the bundled Python and /tmp to the agent own tmp', () => {
  assert.match(hostOf({ spec, guest: '/opt/hermes/bin/hermes' }), /runtime[\\/]python[\\/](bin[\\/]python3|python\.exe)$/)
  assert.equal(hostOf({ spec, guest: '/tmp/hermes-locks' }), join(data, 'native', 'ag_test0001', 'tmp', 'hermes-locks'))
  assert.equal(hostOf({ spec, guest: '/usr/bin/env' }), '/usr/bin/env')
})

test('laying an agent out again never deletes what its shared folders hold', () => {
  const shared = join(data, 'plugins')
  const home = join(data, 'home')
  mkdirSync(shared, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(shared, 'plugin.py'), 'x')
  const agent: SandboxSpec = { ...spec, id: 'ag_test0002', mounts: [{ host: home, guest: '/opt/data', readOnly: false }, { host: shared, guest: '/opt/data/plugins', readOnly: true }] }
  layout(agent)
  layout(agent)
  assert.ok(existsSync(join(shared, 'plugin.py')))
  assert.ok(existsSync(join(home, 'plugins', 'plugin.py')))
})

test('an agent process tree includes what its children started', { skip: process.platform === 'win32' }, async () => {
  const parent = spawn('sh', ['-c', 'sleep 30 & sleep 30 & wait'], { stdio: 'ignore' })
  await sleep(300)
  const pids = tree(parent.pid ?? 0)
  parent.kill('SIGKILL')
  for (const pid of pids.slice(1)) process.kill(pid, 'SIGKILL')
  assert.equal(pids[0], parent.pid)
  assert.equal(pids.length, 3)
})

test('a command the computer lacks fails the run instead of crashing agentd', async () => {
  const home = join(data, 'home-missing')
  mkdirSync(home, { recursive: true })
  const result = await native.run({ spec: { ...spec, id: 'ag_test0003', entrypoint: 'openhut-no-such-command', mounts: [{ host: home, guest: '/opt/data', readOnly: false }] }, command: [] })
  assert.equal(result.code, 127)
  assert.match(result.stdout, /ENOENT/)
})
