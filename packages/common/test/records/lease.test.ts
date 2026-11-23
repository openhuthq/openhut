import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEASE_MS, leaseOf, refreshWithLease, type Secret } from '../../src/records/lease.ts'
import { clientOf, fakeCloud, keyOf, team } from './world.ts'

const gmail = { collection: 'connection', workspace: team, id: 'cn_gmail001' } as const

async function world() {
  const cloud = fakeCloud()
  const mac = clientOf({ device: 'moMac', cloud })
  const server = clientOf({ device: 'moServer', cloud })
  const row = await mac.put({ ...gmail, value: { own: { name: 'Work Gmail', kind: 'gmail' }, vault: { refreshToken: 'r1', accessToken: 'a1' } } })
  let clock = 0
  const time = { now: () => clock, sleep: async (ms: number) => { clock += ms; await new Promise((resolve) => setImmediate(resolve)) } }
  return { cloud, mac, server, row, time }
}

function refresher() {
  const calls: Secret[] = []
  const refresh = async (secret: Secret) => {
    calls.push(secret)
    await new Promise((resolve) => setImmediate(resolve))
    return { refreshToken: `r${calls.length + 1}`, accessToken: `a${calls.length + 1}` }
  }
  return { calls, refresh }
}

test('two runtimes refreshing at once: one takes the lease and refreshes, the other waits for its tokens', async () => {
  const { mac, server, row, time } = await world()
  const { calls, refresh } = refresher()
  const [a, b] = await Promise.all([refreshWithLease({ records: mac, row, refresh, ...time }), refreshWithLease({ records: server, row, refresh, ...time })])
  assert.deepEqual(calls, [{ refreshToken: 'r1', accessToken: 'a1' }])
  assert.deepEqual(a.value.vault, { refreshToken: 'r2', accessToken: 'a2' })
  assert.deepEqual(b.value.vault, a.value.vault)
  assert.equal(Math.max(a.ver, b.ver), 3)
  assert.deepEqual((await mac.get(gmail))?.value.own, { name: 'Work Gmail', kind: 'gmail' })
})

test('the lease is taken even alone, and a rename that lands mid-refresh keeps the new tokens', async () => {
  const { mac, server, row, time } = await world()
  const refresh = async (secret: Secret) => {
    const leased = await mac.get(gmail)
    assert.ok(leased)
    assert.equal(leaseOf(leased)?.device, keyOf('moServer'))
    await mac.put({ ...gmail, current: leased.ver, value: { ...leased.value, own: { name: 'Gmail (work)', kind: 'gmail' } } })
    return { ...secret, refreshToken: 'r2' }
  }
  const done = await refreshWithLease({ records: server, row, refresh, ...time })
  assert.equal(done.ver, 4)
  assert.deepEqual(done.value, { own: { name: 'Gmail (work)', kind: 'gmail' }, vault: { refreshToken: 'r2', accessToken: 'a1' } })
})

test('a lease left by a runtime that crashed expires, and the waiting runtime takes over once', async () => {
  const { mac, server, row, time } = await world()
  const until = time.now() + LEASE_MS
  await mac.put({ ...gmail, current: row.ver, value: { ...row.value, vault: { refreshToken: 'r1', accessToken: 'a1', lease: { device: keyOf('moMac'), until } } } })
  const { calls, refresh } = refresher()
  const done = await refreshWithLease({ records: server, row, refresh, ...time })
  assert.equal(calls.length, 1)
  assert.ok(time.now() >= until)
  assert.deepEqual(done.value.vault, { refreshToken: 'r2', accessToken: 'a2' })
  assert.equal(done.ver, 4)
})

test('a failed refresh gives the lease back and rethrows', async () => {
  const { mac, server, row, time } = await world()
  const failed = await refreshWithLease({ records: server, row, refresh: async () => { throw new Error('invalid_grant') }, ...time }).catch((error: unknown) => error)
  assert.ok(failed instanceof Error && failed.message === 'invalid_grant')
  const after = await mac.get(gmail)
  assert.ok(after)
  assert.equal(leaseOf(after), null)
  assert.deepEqual(after.value.vault, { refreshToken: 'r1', accessToken: 'a1' })
})
