import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, check, signList } from '../../src/cloud/member-list.ts'
import { fromBase64, identity, sign, toBase64 } from '../../src/vault/vault.ts'

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
  const joined = { ...first, members: [...first.members, { email: 'ana@example.com', role: 'member' as const, devices: [key(anaMac)] }], invites: [], removed: [key(invite)] }
  assert.ok(await check({ anchor, chain: [v1, await next(joined, invite)] }))
  const asAdmin = { ...joined, members: [...first.members, { email: 'ana@example.com', role: 'admin' as const, devices: [key(anaMac)] }] }
  assert.equal(await check({ anchor, chain: [v1, await next(asAdmin, invite)] }), null)
  assert.equal(await check({ anchor, chain: [v1, await next({ ...joined, invites: first.invites }, invite)] }), null)
})

test('there is always exactly one owner', async () => {
  const noOwner = { ...first, members: [{ ...first.members[0], role: 'admin' as const }, first.members[1]] }
  assert.equal(await check({ anchor, chain: [v1, await next(noOwner)] }), null)
})

const ana = { email: 'ana@example.com', role: 'member' as const, devices: [key(anaMac)] }
const withSara = (devices: string[]) => [first.members[0], { ...first.members[1], devices }]
const mixed = (signing: { publicKey: Uint8Array }, box: { publicKey: Uint8Array }) => toBase64(new Uint8Array([...signing.publicKey.subarray(0, 32), ...box.publicKey.subarray(32)]))

async function signRaw(text: string) {
  const bytes = new TextEncoder().encode(text)
  const signature = await sign({ secret: moMac.secret, bytes: new Uint8Array([...new TextEncoder().encode('openhut/member-list\0'), ...bytes]) })
  return { object: 'member_list' as const, bytes: toBase64(bytes), by: key(moMac), signature: toBase64(signature) }
}

test('removed only grows by the devices this version drops, so nobody can fill it to block removals', async () => {
  const filler = await Promise.all(Array.from({ length: 3 }, () => identity()))
  const filled = { ...first, removed: filler.map(key) }
  assert.equal(await check({ anchor, chain: [v1, await next(filled, saraMac)] }), null)
  assert.equal(await check({ anchor, chain: [v1, await next(filled)] }), null)
  const extra = { ...first, members: [first.members[0]], removed: [key(saraMac), key(eve)] }
  assert.equal(await check({ anchor, chain: [v1, await next(extra)] }), null)
})

test('a member may put only her own previous devices on removed', async () => {
  const withPhone = await next({ ...first, members: withSara([key(saraMac), key(saraPhone)]) }, saraMac)
  const previous = await anchorOf(withPhone)
  const v3 = (body: Omit<MemberListBody, 'version' | 'previous'>) => signList({ signer: saraMac, body: { ...body, version: 3, previous } })
  assert.ok(await check({ anchor, chain: [v1, withPhone, await v3({ ...first, members: withSara([key(saraMac)]), removed: [key(saraPhone)] })] }))
  for (const banned of [key(invite), key(eve)]) {
    const bans = { ...first, members: withSara([key(saraMac), key(saraPhone)]), removed: [banned] }
    assert.equal(await check({ anchor, chain: [v1, withPhone, await v3(bans)] }), null)
  }
})

test('a removed device cannot come back under a base64 alias or with another X25519 half', async () => {
  const removed = await next({ ...first, members: [first.members[0]], removed: [key(saraMac)] })
  const previous = await anchorOf(removed)
  const mac = key(saraMac)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const alias = mac.slice(0, -1) + alphabet[alphabet.indexOf(mac.at(-1) ?? 'A') ^ 1]
  for (const device of [alias, mixed(saraMac, eve)]) {
    const back = await signList({ signer: moMac, body: { ...first, members: withSara([device]), removed: [key(saraMac)], version: 3, previous } })
    assert.equal(await check({ anchor, chain: [v1, removed, back] }), null)
    assert.equal(await check({ anchor, chain: [v1, removed, { ...back, by: alias }] }), null)
  }
})

test('one signing key cannot sit under two members or two invites', async () => {
  assert.equal(await check({ anchor, chain: [v1, await next({ ...first, members: withSara([key(saraMac), mixed(moMac, eve)]) })] }), null)
  const twice = { ...first, invites: [...first.invites, { email: 'bo@example.com', role: 'member' as const, key: key(invite) }] }
  assert.equal(await check({ anchor, chain: [v1, await next(twice)] }), null)
  const inviteIsDevice = { ...first, invites: [{ email: 'bo@example.com', role: 'member' as const, key: key(saraMac) }] }
  assert.equal(await check({ anchor, chain: [v1, await next(inviteIsDevice)] }), null)
})

test('the invite key cannot join as the new device itself', async () => {
  const joined = { ...first, members: [...first.members, { ...ana, devices: [key(invite)] }], invites: [], removed: [key(invite)] }
  assert.equal(await check({ anchor, chain: [v1, await next(joined, invite)] }), null)
  assert.ok(await check({ anchor, chain: [v1, await next({ ...joined, members: [...first.members, ana] }, invite)] }))
})

test('signed member-list bytes must be the canonical JSON of the list, signed under its label', async () => {
  const text = JSON.stringify(first)
  const honest = await signRaw(text)
  assert.ok(await check({ anchor: await anchorOf(honest), chain: [honest] }))
  for (const variant of [
    text.replace('"workspace":"ws_00000001"', '"workspace":"ws_00000001","workspace":"ws_00000009"'),
    text.replace('"version":1', '"version":1,"extra":1'),
    text.replace('"version":1', '"__proto__":{"x":1},"version":1'),
    JSON.stringify(first, null, 1),
  ]) {
    const list = await signRaw(variant)
    assert.equal(await check({ anchor: await anchorOf(list), chain: [list] }), null)
  }
  const unlabelled = { ...v1, signature: toBase64(await sign({ secret: moMac.secret, bytes: fromBase64(v1.bytes) })) }
  assert.equal(await check({ anchor, chain: [unlabelled] }), null)
})

test('a used or cancelled invite key goes on removed, so nobody can add it as a device or issue it again', async () => {
  const joined = await next({ ...first, members: [...first.members, ana], invites: [], removed: [key(invite)] }, invite)
  assert.ok(await check({ anchor, chain: [v1, joined] }))
  assert.equal(await check({ anchor, chain: [v1, await next({ ...first, members: [...first.members, ana], invites: [] }, invite)] }), null)
  const previous = await anchorOf(joined)
  const v3 = (body: Omit<MemberListBody, 'version' | 'previous'>, signer: typeof moMac) => signList({ signer, body: { ...body, version: 3, previous } })
  const asDevice = { ...first, members: [...first.members, { ...ana, devices: [key(anaMac), key(invite)] }], invites: [], removed: [key(invite)] }
  assert.equal(await check({ anchor, chain: [v1, joined, await v3(asDevice, anaMac)] }), null)
  const reissued = { ...first, members: [...first.members, ana], invites: [{ email: 'bo@example.com', role: 'member' as const, key: key(invite) }], removed: [key(invite)] }
  assert.equal(await check({ anchor, chain: [v1, joined, await v3(reissued, moMac)] }), null)
  assert.equal(await check({ anchor, chain: [v1, await next({ ...first, invites: [] })] }), null)
  assert.ok(await check({ anchor, chain: [v1, await next({ ...first, invites: [], removed: [key(invite)] })] }))
})
