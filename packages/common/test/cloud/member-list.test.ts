import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, check, signList } from '../../src/cloud/member-list.ts'
import { fromBase64, identity, newKey, sign, toBase64 } from '../../src/vault/vault.ts'

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

test('a first list that already removes someone fails check', async () => {
  const genesis = await signList({ signer: moMac, body: { ...first, removed: [key(eve)] } })
  assert.equal(await check({ anchor: await anchorOf(genesis), chain: [genesis] }), null)
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

test('after an admin fills removed to its cap, only the owner may prune it, and then removes a device', async () => {
  const adminMac = await identity()
  const admin = { email: 'al@example.com', role: 'admin' as const, devices: [key(adminMac)] }
  const base = { ...first, members: [...withSara([key(saraMac), key(saraPhone)]), admin] }
  const junk = Array.from({ length: 250 }, (_, i) => ({ email: `f${i}@x.io`, role: 'member' as const, devices: Array.from({ length: 20 }, () => toBase64(newKey(64))) }))
  const chain = [v1, await next(base)]
  const add = async (body: Omit<MemberListBody, 'version' | 'previous'>, signer: typeof moMac) => {
    const list = await signList({ signer, body: { ...body, version: chain.length + 1, previous: await anchorOf(chain[chain.length - 1]) } })
    return { list, ok: await check({ anchor, chain: [...chain, list] }) }
  }
  chain.push((await add({ ...base, members: [...base.members, ...junk] }, adminMac)).list)
  const churned = await add({ ...base, removed: junk.flatMap((member) => member.devices) }, adminMac)
  const full = churned.ok?.removed ?? []
  assert.equal(full.length, 5000)
  chain.push(churned.list)
  const withoutPhone = { ...base, members: [...withSara([key(saraMac)]), admin] }
  assert.equal((await add({ ...withoutPhone, removed: [...full, key(saraPhone)] }, moMac)).ok, null)
  for (const signer of [adminMac, saraMac]) assert.equal((await add({ ...base, removed: full.slice(1) }, signer)).ok, null)
  assert.equal((await add({ ...base, members: [...withSara([key(saraMac), key(saraPhone), full[0]]), admin], removed: full.slice(1) }, saraMac)).ok, null)
  assert.equal((await add({ ...base, removed: [...full.slice(1), key(eve)] }, moMac)).ok, null)
  assert.equal((await add({ ...withoutPhone, removed: [] }, moMac)).ok, null)
  const pruned = await add({ ...withoutPhone, removed: [key(saraPhone)] }, moMac)
  assert.deepEqual(pruned.ok?.removed, [key(saraPhone)])
  chain.push(pruned.list)
  assert.ok((await add({ ...withoutPhone, members: [first.members[0], admin], removed: [key(saraPhone), key(saraMac)] }, adminMac)).ok)
  assert.ok((await add({ ...withoutPhone, members: [...withSara([key(saraMac), full[0]]), admin], removed: [key(saraPhone)] }, saraMac)).ok)
})

test('only an owner or admin moves the key version, and never back', async () => {
  const { version: _v, previous: _p, ...rest } = first
  assert.equal((await check({ anchor, chain: [v1, await next({ ...rest, keyVersion: 2 })] }))?.keyVersion, 2)
  assert.equal(await check({ anchor, chain: [v1, await next({ ...rest, keyVersion: 2 }, saraMac)] }), null)
  const bumped = await signList({ signer: moMac, body: { ...first, keyVersion: 3 } })
  const down = await signList({ signer: moMac, body: { ...first, version: 2, previous: await anchorOf(bumped), keyVersion: 2 } })
  assert.equal(await check({ anchor: await anchorOf(bumped), chain: [bumped, down] }), null)
})

test('a runtime device is listed for records only: it can never sign a member list, and it stays a runtime', async () => {
  const server = await identity()
  const withServer = { ...first, members: [{ ...first.members[0], devices: [key(moMac), key(server)] }, first.members[1]], runtimes: [key(server)] }
  const v2 = await next(withServer)
  assert.deepEqual(await check({ anchor, chain: [v1, v2] }), { ...withServer, version: 2, previous: anchor })
  const v2Anchor = await anchorOf(v2)
  const third = (body: MemberListBody, signer = moMac) => signList({ signer, body: { ...body, version: 3, previous: v2Anchor } })
  const evicted = { ...withServer, members: [{ email: 'eve@example.com', role: 'owner' as const, devices: [key(eve)] }, { ...withServer.members[0], role: 'admin' as const }, first.members[1]] }
  assert.equal(await check({ anchor, chain: [v1, v2, await third(evicted, server)] }), null)
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...withServer, runtimes: [] })] }), null)
  assert.equal(await check({ anchor, chain: [v1, await next({ ...first, runtimes: [key(server)] })] }), null)
})

const DAY = 24 * 60 * 60_000
const T = 1_800_000_000_000
type Signed = Awaited<ReturnType<typeof signList>>
const dated = async () => {
  const kit = key(eve)
  const body: MemberListBody = { workspace: 'ws_00000002', version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices: [key(moMac), kit], kit }, first.members[1]], invites: [], removed: [], at: T, added: { [key(moMac)]: T, [kit]: T, [key(saraMac)]: T } }
  const list = await signList({ signer: moMac, body })
  return { body, list, anchor: await anchorOf(list) }
}
const after = (from: { body: MemberListBody; list: Signed }) => async (change: Partial<MemberListBody>, signer: typeof moMac) =>
  signList({ signer, body: { ...from.body, ...change, version: from.body.version + 1, previous: await anchorOf(from.list) } })

test('the kit key may only add one device to its own person, never remove or change anything else', async () => {
  const start = await dated()
  const v2 = after(start)
  const at = T + 1000
  const mo = start.body.members[0]
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, await v2({ members: [{ ...mo, devices: [...mo.devices, key(anaMac)] }, first.members[1]], at, added: { ...start.body.added, [key(anaMac)]: at } }, eve)] }))
  const changes: Partial<MemberListBody>[] = [
    { members: [{ ...mo, devices: [key(eve), key(anaMac)] }, first.members[1]], removed: [key(moMac)], at, added: { [key(eve)]: T, [key(anaMac)]: at, [key(saraMac)]: T } },
    { members: [{ ...mo, devices: [...mo.devices, key(anaMac), key(saraPhone)] }, first.members[1]], at, added: { ...start.body.added, [key(anaMac)]: at, [key(saraPhone)]: at } },
    { members: [mo, { ...first.members[1], devices: [key(saraMac), key(anaMac)] }], at, added: { ...start.body.added, [key(anaMac)]: at } },
    { members: [{ ...mo, devices: [...mo.devices, key(anaMac)] }, { ...first.members[1], role: 'admin' }], at, added: { ...start.body.added, [key(anaMac)]: at } },
    { keyVersion: 2, at },
  ]
  for (const change of changes) assert.equal(await check({ anchor: start.anchor, chain: [start.list, await v2(change, eve)] }), null)
})

test('a new device carries the time of the list that added it, and the time never goes back', async () => {
  const start = await dated()
  const v2 = after(start)
  const mo = start.body.members[0]
  const withAna = { members: [{ ...mo, devices: [...mo.devices, key(anaMac)] }, first.members[1]] }
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, await v2({ ...withAna, at: T + 5, added: { ...start.body.added, [key(anaMac)]: T + 5 } }, moMac)] }))
  for (const change of [{ at: T + 5, added: { ...start.body.added, [key(anaMac)]: T - 10 * DAY } }, { at: T + 5, added: start.body.added }, { at: T - 1, added: { ...start.body.added, [key(anaMac)]: T - 1 } }, { at: undefined, added: undefined }]) {
    assert.equal(await check({ anchor: start.anchor, chain: [start.list, await v2({ ...withAna, ...change }, moMac)] }), null)
  }
  assert.equal(await check({ anchor: start.anchor, chain: [start.list, await v2({ at: T + 5, added: { ...start.body.added, [key(moMac)]: T + 5 } }, moMac)] }), null)
})

test('a device younger than 3 days cannot remove an older one; after 3 days, or the other way round, it can', async () => {
  const start = await dated()
  const mo = start.body.members[0]
  const joined = T + DAY
  const v2 = await after(start)({ members: [{ ...mo, devices: [...mo.devices, key(anaMac)] }, first.members[1]], at: joined, added: { ...start.body.added, [key(anaMac)]: joined } }, eve)
  const body2 = await check({ anchor: start.anchor, chain: [start.list, v2] })
  assert.ok(body2)
  const v3 = after({ body: body2, list: v2 })
  const withoutOld = (at: number) => ({ members: [{ ...mo, devices: [key(eve), key(anaMac)] }, first.members[1]], removed: [key(moMac)], at, added: { [key(eve)]: T, [key(saraMac)]: T, [key(anaMac)]: joined } })
  assert.equal(await check({ anchor: start.anchor, chain: [start.list, v2, await v3(withoutOld(joined + DAY), anaMac)] }), null)
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, await v3(withoutOld(joined + 3 * DAY + 1), anaMac)] }))
  const withoutNew = { members: [mo, first.members[1]], removed: [key(anaMac)], at: joined + 60_000, added: start.body.added }
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, await v3(withoutNew, moMac)] }))
})
