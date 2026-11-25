import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, bodyOf, check, nextOf, signList, withoutDevices } from '../../src/cloud/member-list.ts'
import { fromBase64, identity, newKey, sign, toBase64 } from '../../src/vault/public.ts'

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

test('only an owner or admin moves a device into runtimes, and never the last device that can sign', async () => {
  const [laptop, server] = await Promise.all([identity(), identity()])
  const team = { ...first, members: [first.members[0], { email: 'ada@example.com', role: 'admin' as const, devices: [key(laptop)] }, { ...first.members[1], devices: [key(saraMac), key(server)] }] }
  const v2 = await next(team)
  const v2Anchor = await anchorOf(v2)
  const third = (body: MemberListBody, signer = moMac) => signList({ signer, body: { ...body, version: 3, previous: v2Anchor } })
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(laptop)] }, saraMac)] }), null)
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(server)] }, saraMac)] }), null)
  assert.ok(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(server)] })] }))
  assert.ok(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(server)] }, laptop)] }))
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(moMac), key(laptop)] })] }), null)
  assert.ok(await check({ anchor, chain: [v1, v2, await third({ ...team, runtimes: [key(laptop)] })] }))
})

test('a viewer (a phone or browser) is listed per person, never signs a member list, never becomes a device, and leaves on removed', async () => {
  const phone = await identity()
  const withPhone = { ...first, members: [{ ...first.members[0], viewers: [key(phone)] }, first.members[1]] }
  const v2 = await next(withPhone)
  assert.deepEqual(await check({ anchor, chain: [v1, v2] }), { ...withPhone, version: 2, previous: anchor })
  const v2Anchor = await anchorOf(v2)
  const third = (body: MemberListBody, signer = moMac) => signList({ signer, body: { ...body, version: 3, previous: v2Anchor } })
  const withoutSara = { ...withPhone, members: [withPhone.members[0], { ...first.members[1], devices: [] }], removed: [key(saraMac)] }
  assert.ok(await check({ anchor, chain: [v1, v2, await third(withoutSara)] }))
  assert.equal(await check({ anchor, chain: [v1, v2, await third(withoutSara, phone)] }), null)
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...withPhone, members: [{ ...first.members[0], devices: [key(moMac), key(phone)] }, first.members[1]] })] }), null)
  assert.equal(await check({ anchor, chain: [v1, v2, await third({ ...withPhone, members: [{ ...first.members[0], viewers: [] }, first.members[1]] })] }), null)
  assert.ok(await check({ anchor, chain: [v1, v2, await third({ ...withPhone, members: [{ ...first.members[0], viewers: [] }, first.members[1]], removed: [key(phone)] })] }))
  assert.equal(await check({ anchor, chain: [v1, await next({ ...first, members: [{ ...first.members[0], viewers: [key(saraMac)] }, first.members[1]] })] }), null)
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

test('in a team room an admin’s account key marked as kit may only add one device, even when old: no removing devices or people, no key change', async () => {
  const kit = key(eve)
  const team = (marked: boolean): MemberListBody => ({ workspace: 'ws_00000003', version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices: [key(moMac)] }, { email: 'sara@example.com', role: 'admin', devices: [key(saraMac), kit], ...marked && { kit } }, { email: 'ana@example.com', role: 'member', devices: [key(anaMac)] }], invites: [], removed: [], at: T, added: { [key(moMac)]: T, [key(saraMac)]: T, [kit]: T, [key(anaMac)]: T } })
  const at = T + 4 * 24 * 60 * 60_000
  for (const marked of [false, true]) {
    const body = team(marked)
    const list = await signList({ signer: moMac, body })
    const v2 = after({ body, list })
    const [mo, sara, ana] = body.members
    const takeover = await v2({ members: [mo, { ...sara, devices: [kit, key(saraPhone)] }], removed: [key(saraMac), key(anaMac)], keyVersion: 2, at, added: { [key(moMac)]: T, [kit]: T, [key(saraPhone)]: at } }, eve)
    assert.equal(Boolean(await check({ anchor: await anchorOf(list), chain: [list, takeover] })), !marked)
    if (!marked) continue
    const refused: Partial<MemberListBody>[] = [
      { members: [mo, { ...sara, devices: [kit] }, ana], removed: [key(saraMac)], at, added: { [key(moMac)]: T, [kit]: T, [key(anaMac)]: T } },
      { members: [mo, sara], removed: [key(anaMac)], at, added: { [key(moMac)]: T, [key(saraMac)]: T, [kit]: T } },
      { keyVersion: 2, at },
    ]
    for (const change of refused) assert.equal(await check({ anchor: await anchorOf(list), chain: [list, await v2(change, eve)] }), null)
    assert.ok(await check({ anchor: await anchorOf(list), chain: [list, await v2({ members: [mo, { ...sara, devices: [...sara.devices, key(saraPhone)] }, ana], at, added: { ...body.added, [key(saraPhone)]: at } }, eve)] }))
  }
})

test('withoutDevices drops devices everywhere and puts each on removed once; nextOf links to the list it follows', async () => {
  const body: MemberListBody = { ...first, members: [{ ...first.members[0], devices: [key(moMac), key(saraPhone)] }, first.members[1]], removed: [key(eve)], runtimes: [key(saraPhone)], added: { [key(moMac)]: T, [key(saraPhone)]: T, [key(saraMac)]: T }, names: { [key(saraPhone)]: 'Phone' } }
  const cut = withoutDevices({ body, gone: [key(saraPhone), key(eve)] })
  assert.deepEqual([cut.members[0]?.devices, cut.removed, cut.runtimes, cut.added, cut.names], [[key(moMac)], [key(eve), key(saraPhone)], [], { [key(moMac)]: T, [key(saraMac)]: T }, {}])
  const list = await signList({ signer: moMac, body })
  assert.deepEqual(bodyOf(list), body)
  const following = await nextOf({ list, body, me: key(moMac) })
  assert.deepEqual([following.version, following.previous], [2, await anchorOf(list)])
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

test('a new device can remove an older one right away, and the other way round', async () => {
  const start = await dated()
  const mo = start.body.members[0]
  const joined = T + DAY
  const v2 = await after(start)({ members: [{ ...mo, devices: [...mo.devices, key(anaMac)] }, first.members[1]], at: joined, added: { ...start.body.added, [key(anaMac)]: joined } }, eve)
  const body2 = await check({ anchor: start.anchor, chain: [start.list, v2] })
  assert.ok(body2)
  const v3 = after({ body: body2, list: v2 })
  const withoutOld = (at: number) => ({ members: [{ ...mo, devices: [key(eve), key(anaMac)] }, first.members[1]], removed: [key(moMac)], at, added: { [key(eve)]: T, [key(saraMac)]: T, [key(anaMac)]: joined } })
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, await v3(withoutOld(joined + 60_000), anaMac)] }))
  const withoutNew = { members: [mo, first.members[1]], removed: [key(anaMac)], at: joined + 60_000, added: start.body.added }
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, await v3(withoutNew, moMac)] }))
})

test('an admin who joined today can let a device in and remove people', async () => {
  const start = await dated()
  const joined = T + DAY
  const ana = { email: 'ana@example.com', role: 'admin' as const, devices: [key(anaMac)] }
  const v2 = await after(start)({ members: [...start.body.members, ana], at: joined, added: { ...start.body.added, [key(anaMac)]: joined } }, moMac)
  const body2 = await check({ anchor: start.anchor, chain: [start.list, v2] })
  assert.ok(body2)
  const at = joined + 60_000
  const sara = { ...first.members[1], devices: [key(saraMac), key(saraPhone)] }
  const letIn = await after({ body: body2, list: v2 })({ members: [start.body.members[0], sara, ana], at, added: { ...body2.added, [key(saraPhone)]: at } }, anaMac)
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, letIn] }))
  const removed = await after({ body: body2, list: v2 })({ members: [start.body.members[0], ana], removed: [key(saraMac)], keyVersion: 2, at, added: { [key(moMac)]: T, [key(eve)]: T, [key(anaMac)]: joined } }, anaMac)
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, v2, removed] }))
})

test('a device name never changes once listed', async () => {
  const start = await dated()
  const v2 = after(start)
  assert.ok(await check({ anchor: start.anchor, chain: [start.list, await v2({ keyVersion: 2, at: T + 1000 }, moMac)] }))
  const named = await v2({ at: T + 1000, names: { [key(moMac)]: 'Mo’s MacBook Air' } }, moMac)
  assert.equal(await check({ anchor: start.anchor, chain: [start.list, named] }), null)
  assert.equal(await check({ anchor: start.anchor, chain: [start.list, await v2({ at: T + 1000, names: { [key(anaMac)]: 'Not listed' } }, moMac)] }), null)
})

test('someone who left can rejoin with the same device on a new invite, and only then: the key leaves removed in the join list', async () => {
  const gone = await next({ ...first, members: [first.members[0]], removed: [key(saraMac)] }, saraMac)
  const body = await check({ anchor, chain: [v1, gone] })
  assert.ok(body)
  const asked = await identity()
  const invited = await signList({ signer: moMac, body: { ...body, version: 3, previous: await anchorOf(gone), invites: [...body.invites, { email: 'sara@example.com', role: 'member', key: key(asked) }] } })
  const previous = await anchorOf(invited)
  const join = (removed: string[], signer = asked) => signList({ signer, body: { ...body, version: 4, previous, members: [...body.members, { email: 'sara@example.com', role: 'member', devices: [key(saraMac)] }], removed } })
  assert.ok(await check({ anchor, chain: [v1, gone, invited, await join([key(asked)])] }))
  assert.equal(await check({ anchor, chain: [v1, gone, invited, await join([key(saraMac), key(asked)])] }), null)
  assert.equal(await check({ anchor, chain: [v1, gone, invited, await join([key(asked)], saraMac)] }), null)
  assert.equal(await check({ anchor, chain: [v1, gone, await signList({ signer: saraMac, body: { ...body, version: 3, previous: await anchorOf(gone), members: [...body.members, { email: 'sara@example.com', role: 'member', devices: [key(saraMac)] }], removed: [] } })] }), null)
})

test('the managed signer adds devices and invited people only while listed; it cannot change itself, and only the owner removes it', async () => {
  const [ours, other] = await Promise.all([identity(), identity()])
  const managed = { ...first, managed: key(ours) }
  const m1 = await signList({ signer: moMac, body: managed })
  const root = await anchorOf(m1)
  const step = (body: MemberListBody, signer: typeof moMac) => signList({ signer, body: { ...body, version: 2, previous: root } })
  const ok = async (body: MemberListBody, signer: typeof moMac) => Boolean(await check({ anchor: root, chain: [m1, await step(body, signer)] }))
  const [mo, sara] = managed.members
  assert.ok(await ok({ ...managed, members: [{ ...mo, devices: [key(moMac), key(eve)] }, sara] }, ours), 'adds the owner’s new browser')
  assert.ok(await ok({ ...managed, members: [mo, sara, { email: 'ana@example.com', role: 'member', devices: [key(anaMac)] }], invites: [], removed: [key(invite)] }, ours), 'lets the invited person in')
  assert.ok(!await ok({ ...managed, members: [mo, sara, { email: 'eve@example.com', role: 'member', devices: [key(eve)] }] }, ours), 'nobody it wasn’t asked to let in')
  assert.ok(!await ok({ ...managed, members: [mo], removed: [key(saraMac)] }, ours), 'no removing people')
  assert.ok(!await ok({ ...managed, members: [mo, { ...sara, role: 'admin' }] }, ours), 'no role changes')
  assert.ok(!await ok({ ...managed, members: [{ ...mo, devices: [key(moMac), key(eve)] }, sara], runtimes: [key(eve)] }, ours), 'no runtimes')
  assert.ok(!await ok({ ...managed, managed: key(other) }, ours), 'can’t add another managed signer')
  assert.ok(!await ok({ ...first }, ours), 'can’t drop itself')
  assert.ok(!await ok({ ...first }, saraMac), 'a member can’t remove it')
  assert.ok(!await ok({ ...managed, managed: key(other) }, saraMac), 'or replace it')
  assert.ok(await ok({ ...first }, moMac), 'the owner can')
  const off = await step({ ...first }, moMac)
  const later = await signList({ signer: ours, body: { ...first, members: [{ ...mo, devices: [key(moMac), key(eve)] }, sara], version: 3, previous: await anchorOf(off) } })
  assert.equal(await check({ anchor: root, chain: [m1, off, later] }), null, 'it signs only while listed')
  assert.equal(await check({ anchor: await anchorOf(await signList({ signer: moMac, body: { ...first, managed: key(moMac) } })), chain: [await signList({ signer: moMac, body: { ...first, managed: key(moMac) } })] }), null, 'it is never a device too')
})
