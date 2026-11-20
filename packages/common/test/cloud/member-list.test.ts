import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, check, signList } from '../../src/cloud/member-list.ts'
import { fromBase64, identity, toBase64 } from '../../src/vault/vault.ts'

const [moMac, saraMac, saraPhone, anaMac, invite, eve] = await Promise.all(Array.from({ length: 6 }, () => identity()))
const key = (who: { publicKey: Uint8Array }) => toBase64(who.publicKey)

const first: MemberListBody = {
  workspace: 'ws_00000001',
  version: 1,
  previous: null,
  members: [
    { email: 'mo@example.com', role: 'owner', devices: [key(moMac)] },
    { email: 'sara@example.com', role: 'member', devices: [key(saraMac)] },
  ],
  invites: [{ email: 'ana@example.com', role: 'member', key: key(invite) }],
  removed: [],
}
const v1 = await signList({ signer: moMac, body: first })
const anchor = await anchorOf(v1)

async function next(body: Omit<MemberListBody, 'version' | 'previous'>, signer = moMac) {
  return signList({ signer, body: { ...body, version: 2, previous: anchor } })
}

test('the anchored list checks', async () => {
  assert.deepEqual(await check({ anchor, chain: [v1] }), first)
  assert.equal(await check({ anchor: toBase64(new Uint8Array(32)), chain: [v1] }), null)
})

test('a list with one changed email or role fails check', async () => {
  for (const change of [{ email: 'eve@example.com' }, { role: 'admin' }]) {
    const body = JSON.parse(new TextDecoder().decode(fromBase64(v1.bytes)))
    Object.assign(body.members[1], change)
    const tampered = { ...v1, bytes: toBase64(new TextEncoder().encode(JSON.stringify(body))) }
    assert.equal(await check({ anchor: await anchorOf(tampered), chain: [tampered] }), null)
  }
})

test('version n+1 signed by the owner checks, and a skipped version or a wrong previous fails', async () => {
  const removed = { ...first, members: [first.members[0]], removed: [key(saraMac)] }
  assert.ok(await check({ anchor, chain: [v1, await next(removed)] }))
  assert.equal(await check({ anchor, chain: [v1, await signList({ signer: moMac, body: { ...removed, version: 3, previous: anchor } })] }), null)
  assert.equal(await check({ anchor, chain: [v1, await signList({ signer: moMac, body: { ...removed, version: 2, previous: toBase64(new Uint8Array(32)) } })] }), null)
})

test('a removed device must stay removed', async () => {
  const dropped = { ...first, members: [first.members[0]] }
  assert.equal(await check({ anchor, chain: [v1, await next(dropped)] }), null)
})

test('a device not on the list cannot sign the next version', async () => {
  const promoted = { ...first, members: [first.members[0], { ...first.members[1], role: 'admin' as const }] }
  assert.equal(await check({ anchor, chain: [v1, await next(promoted, eve)] }), null)
})

test('a member may add her own device but not change anyone else', async () => {
  const withPhone = { ...first, members: [first.members[0], { ...first.members[1], devices: [key(saraMac), key(saraPhone)] }] }
  assert.ok(await check({ anchor, chain: [v1, await next(withPhone, saraMac)] }))
  const selfPromoted = { ...first, members: [first.members[0], { ...first.members[1], role: 'admin' as const }] }
  assert.equal(await check({ anchor, chain: [v1, await next(selfPromoted, saraMac)] }), null)
  const ownerDevice = { ...first, members: [{ ...first.members[0], devices: [key(moMac), key(eve)] }, first.members[1]] }
  assert.equal(await check({ anchor, chain: [v1, await next(ownerDevice, saraMac)] }), null)
})

test('an invite key may add only its own person, with its role, and is used up', async () => {
  const joined = { ...first, members: [...first.members, { email: 'ana@example.com', role: 'member' as const, devices: [key(anaMac)] }], invites: [] }
  assert.ok(await check({ anchor, chain: [v1, await next(joined, invite)] }))
  const asAdmin = { ...joined, members: [...first.members, { email: 'ana@example.com', role: 'admin' as const, devices: [key(anaMac)] }] }
  assert.equal(await check({ anchor, chain: [v1, await next(asAdmin, invite)] }), null)
  assert.equal(await check({ anchor, chain: [v1, await next({ ...joined, invites: first.invites }, invite)] }), null)
})

test('there is always exactly one owner', async () => {
  const noOwner = { ...first, members: [{ ...first.members[0], role: 'admin' as const }, first.members[1]] }
  assert.equal(await check({ anchor, chain: [v1, await next(noOwner)] }), null)
})
