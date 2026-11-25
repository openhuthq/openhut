import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const data = mkdtempSync(join(tmpdir(), 'agentd-in-process-'))
Object.assign(process.env, { OPENHUT_FAKE_SANDBOX: '1', AGENTD_DATA: data })
delete process.env.AGENTD_SOCK
const { agentd, liveBrowser } = await import('../../../src/server/platform/agentd.ts')
const { config } = await import('../../../src/server/platform/config.ts')
after(() => rmSync(data, { recursive: true, force: true }))

const FILES = { 'config.yaml': 'a', '.env': 'b', 'SOUL.md': 'c', 'auth.json': 'd' }

test('with a sandbox and no agentd socket, the server runs agentd in its own process', async () => {
  assert.equal(config.agentdInProcess, true)
  assert.equal((await agentd.health()).firewall, true)
  assert.deepEqual(await agentd.apply({ id: 'ag_inproc01', net: 1, files: FILES, browser: false, running: true }), { applied: 'ag_inproc01', change: 'created' })
  assert.equal(readFileSync(join(data, 'agent-conf', 'ag_inproc01', 'SOUL.md'), 'utf8'), 'c')
  assert.equal((await agentd.ps()).states.ag_inproc01, 'running')
  assert.deepEqual(await agentd.stop({ id: 'ag_inproc01' }), { stopped: 'ag_inproc01' })
  assert.deepEqual(await agentd.remove({ id: 'ag_inproc01' }), { removed: 'ag_inproc01' })
})

test('an in-process stream ends when either side closes', async () => {
  let ended = false
  const live = liveBrowser({ id: 'ag_inproc02', fps: 1, onLine: () => undefined, onEnd: () => { ended = true } })
  for (let tries = 0; tries < 50 && !ended; tries++) await sleep(20)
  assert.equal(ended, true)
  live.close()
})
