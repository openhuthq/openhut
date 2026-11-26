import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.OPENHUT_HERE_TOKEN_SHA256 = 'a'.repeat(64)
const { forward } = await import('../../../src/server/relay/forward.ts')
const { HERE } = await import('../../../src/server/team/home.ts')
const { fakeComputer } = await import('./fake-computer.ts')

test('while the main\'s own runtime is reconnecting, it counts as offline and a call waits for it instead of failing', async () => {
  assert.equal(forward.online(HERE), false)
  const ready = forward.ready({ on: HERE, ms: 10_000 })
  fakeComputer({ id: HERE })
  assert.equal(await ready, true)
  assert.equal(forward.online(HERE), true)
})

test('a wait for the main\'s own runtime gives up after its time, and other computers never wait', async () => {
  forward.unlink({ computer: HERE })
  assert.equal(await forward.ready({ on: HERE, ms: 20 }), false)
  assert.equal(await forward.ready({ on: 'cm_elsewhere', ms: 10_000 }), true)
})
