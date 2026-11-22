import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Letter, MemberList, MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, signList } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, identity, letter, newKey, toBase64, type Identity } from '@openhut/common/vault/vault.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { accountDevice, keysService } from '../../../src/server/cloud/keys-service.ts'
import { roomKeys } from '../../../src/server/cloud/room-keys.ts'
import { keyStore } from '../../../src/server/cloud/key-store.ts'

await migrate()
const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
const me = await keysService.device()
const anchor = await anchorOf(account.list)
const DAY = 24 * 60 * 60_000
const homeChain: MemberList[] = [account.list]

async function next({ signer, change }: { signer: Identity; change: (body: MemberListBody) => Partial<MemberListBody> }): Promise<MemberList> {
  const body = roomKeys.members()
  const room = roomKeys.room()
  assert.ok(body && room)
  return signList({ signer, body: { ...body, version: body.version + 1, previous: await anchorOf(room.list), at: (body.at ?? 0) + 4 * DAY, ...change(body) } })
}

async function keyLetter({ id, sender, plain }: { id: string; sender: Identity; plain: object }): Promise<Letter> {
  const body = await letter({ sender, to: me.publicKey, workspace: account.workspace.id, purpose: 'workspace-key', version: 1, plain: new TextEncoder().encode(JSON.stringify({ ...plain, anchor })) })
  return { id, object: 'letter', to: toBase64(me.publicKey), from: toBase64(sender.publicKey), workspace: account.workspace.id, purpose: 'workspace-key', body: toBase64(body ?? new Uint8Array()) }
}

test('a member list that lands while an account-key letter is being taken keeps the new account key, and so does a home room saved from a copy read before the letter', async () => {
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const me = await keysService.device()
  const macA = await identity()
  const key = newKey()
  const kit = toBase64((await accountDevice(key)).publicKey)
  const oldKit = toBase64((await accountDevice(Buffer.from(account.key, 'base64'))).publicKey)
  const body = roomKeys.members()
  assert.ok(body)
  const at = Date.now()
  const mine = body.members[0]
  const devices = [...mine.devices.filter((each) => each !== oldKit), toBase64(macA.publicKey), kit]
  const second = await signList({ signer: me, body: { ...body, version: 2, previous: await anchorOf(account.list), at, members: [{ ...mine, devices, kit }], removed: [...body.removed, oldKit], added: { ...Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== oldKit)), [toBase64(macA.publicKey)]: at, [kit]: at } } })
  assert.ok(await roomKeys.advance({ lists: [second] }))
  homeChain.push(second)
  const phone = await identity()
  const third = await signList({ signer: me, body: { ...body, version: 3, previous: await anchorOf(second), at, members: [{ ...mine, devices: [...devices, toBase64(phone.publicKey)], kit }], removed: [...body.removed, oldKit], added: { ...Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== oldKit)), [toBase64(macA.publicKey)]: at, [kit]: at, [toBase64(phone.publicKey)]: at } } })
  const sealed = await letter({ sender: macA, to: me.publicKey, workspace: account.workspace.id, purpose: 'account-key', version: 1, plain: key })
  const found = [{ id: 'let_1', object: 'letter' as const, workspace: account.workspace.id, to: toBase64(me.publicKey), from: toBase64(macA.publicKey), purpose: 'account-key' as const, body: toBase64(sealed ?? new Uint8Array()), createdAt: new Date().toISOString() }]
  const stale = roomKeys.room()
  const advanced = roomKeys.advance({ lists: [third] })
  assert.deepEqual(await roomKeys.takeLetters({ found }), ['let_1'])
  assert.ok(await advanced)
  homeChain.push(third)
  assert.equal(keysService.account()?.key, toBase64(key))
  assert.equal(roomKeys.members()?.version, 3)
  const latest = roomKeys.room()
  assert.ok(stale && latest)
  await roomKeys.setRoom({ ...stale, list: latest.list })
  assert.equal(keysService.account()?.key, toBase64(key))
})

test('an admin’s workspace-key letter can’t plant an own key or change the slot key, and old keys are kept; my own device’s letter can pin the own key', async () => {
  const sara = await identity()
  const saraKey = toBase64(sara.publicKey)
  const ownBefore = toBase64(await roomKeys.own() ?? new Uint8Array())
  const firstKey = account.workspace.key
  const v2 = await next({ signer: me, change: (body) => ({ members: [...body.members, { email: 'sara@example.com', role: 'admin', devices: [saraKey] }], added: { ...body.added, [saraKey]: (body.at ?? 0) + 4 * DAY } }) })
  assert.ok(await roomKeys.advance({ lists: [v2] }))
  homeChain.push(v2)
  const v3 = await next({ signer: sara, change: () => ({ keyVersion: 2 }) })
  assert.ok(await roomKeys.advance({ lists: [v3] }))
  homeChain.push(v3)
  const evil = toBase64(newKey())
  const done = await roomKeys.takeLetters({ found: [await keyLetter({ id: 'evil', sender: sara, plain: { key: toBase64(newKey()), version: 2, own: evil, slot: toBase64(newKey()), old: {} } })] })
  assert.deepEqual(done, ['evil'])
  const workspace = roomKeys.room()?.workspace
  assert.equal(workspace?.version, 2)
  assert.equal(toBase64(await roomKeys.own() ?? new Uint8Array()), ownBefore)
  assert.notEqual(ownBefore, evil)
  assert.equal(workspace?.slot, firstKey)
  assert.equal(workspace?.old?.['1'], firstKey)

  const laptop = await identity()
  const laptopKey = toBase64(laptop.publicKey)
  const v4 = await next({ signer: me, change: (body) => ({ keyVersion: 3, members: body.members.map((member) => member.email === 'mo@example.com' ? { ...member, devices: [...member.devices, laptopKey] } : member), added: { ...body.added, [laptopKey]: (body.at ?? 0) + 4 * DAY } }) })
  assert.ok(await roomKeys.advance({ lists: [v4] }))
  homeChain.push(v4)
  const pinned = toBase64(newKey())
  await roomKeys.takeLetters({ found: [await keyLetter({ id: 'mine', sender: laptop, plain: { key: toBase64(newKey()), version: 3, own: pinned } })] })
  assert.equal(toBase64(await roomKeys.own() ?? new Uint8Array()), pinned)
  assert.equal(roomKeys.room()?.workspace.old?.['2'], workspace?.key)
})

test('in a team room this Mac lists the account key as its kit, moves the mark when Change keys makes a new one, and the 12 words bring the team room back on a fresh Mac', async () => {
  const boss = await identity()
  const bossKey = toBase64(boss.publicKey)
  const ws = 'TeamRoom0001'
  const at = Date.now() - 1000
  const v1 = await signList({ signer: boss, body: { workspace: ws, version: 1, previous: null, members: [{ email: 'boss@example.com', role: 'owner', devices: [bossKey] }], invites: [], removed: [], at, added: { [bossKey]: at } } })
  const mine = toBase64(me.publicKey)
  const v2 = await signList({ signer: boss, body: { workspace: ws, version: 2, previous: await anchorOf(v1), members: [{ email: 'boss@example.com', role: 'owner', devices: [bossKey] }, { email: 'mo@example.com', role: 'member', devices: [mine] }], invites: [], removed: [], at: at + 1, added: { [bossKey]: at, [mine]: at + 1 } } })
  await roomKeys.addTeam({ ws, list: v2, first: v1 })
  const puts: MemberList[] = []
  await roomKeys.refresh({ ws, call: async ({ method, path, body }) => {
    if (method === 'PUT' && path === '/members') puts.push(body as MemberList)
    return { status: 200, json: { object: 'list', data: [] } }
  } })
  const v3 = puts[0]
  assert.ok(v3)
  const oldKit = await keysService.accountDeviceKey()
  const listed = await check({ anchor: await anchorOf(v1), chain: [v1, v2, v3] })
  assert.deepEqual(listed?.members.find((member) => member.email === 'mo@example.com'), { email: 'mo@example.com', role: 'member', devices: [mine, oldKit], kit: oldKit })
  const changed = await keysService.change()
  homeChain.push(changed.list)
  await keysService.adopt({ account: changed.next })
  const kit = await keysService.accountDeviceKey()
  assert.ok(kit && kit !== oldKit)
  assert.equal(changed.letters.some((each) => each.to === kit || each.to === oldKit), false)
  await roomKeys.refresh({ ws, call: async ({ method, path, body }) => {
    if (method === 'PUT' && path === '/members') puts.push(body as MemberList)
    return { status: 200, json: { object: 'list', data: [] } }
  } })
  const v4 = puts[1]
  assert.ok(v4)
  const moved = await check({ anchor: await anchorOf(v1), chain: [v1, v2, v3, v4] })
  assert.deepEqual([moved?.members.find((member) => member.email === 'mo@example.com'), moved?.removed], [{ email: 'mo@example.com', role: 'member', devices: [mine, kit], kit }, [oldKit]])

  const teamKey = toBase64(newKey())
  const sealed = await letter({ sender: boss, to: me.publicKey, workspace: ws, purpose: 'workspace-key', version: 1, plain: new TextEncoder().encode(JSON.stringify({ key: teamKey, version: 1, anchor: await anchorOf(v1) })) })
  await roomKeys.takeLetters({ ws, found: [{ id: 'welcome', object: 'letter', to: mine, from: bossKey, workspace: ws, purpose: 'workspace-key', body: toBase64(sealed ?? new Uint8Array()) }] })
  const team = roomKeys.room(ws)
  assert.equal(team?.workspace.key, teamKey)
  const current = keysService.account()
  assert.ok(current && team)
  const words = await keysService.newKit()
  await keysService.setKit({ box: words.box, savedAt: new Date().toISOString() })
  const workspaces = [{ ...await keysService.workspaceBox({ account: current }), chain: homeChain }, { ...await keysService.workspaceBox({ account: current, room: team }), chain: [v1, v2, v3, v4] }]
  await keysService.setSession(undefined)
  await keysService.forget()
  await keysService.setLocked({ sub: 'dev-mo', email: 'mo@example.com' })
  const restored = await keysService.restore({ words: words.words, kit: words.box, workspaces })
  const back = restored?.teams?.[0]
  assert.equal(restored?.workspace.id, account.workspace.id)
  assert.equal(back?.workspace.key, teamKey)
  const fresh = toBase64((await keysService.device()).publicKey)
  assert.notEqual(fresh, mine)
  const after = back && await check({ anchor: await anchorOf(v1), chain: [v1, v2, v3, v4, back.list] })
  assert.deepEqual(after?.members.find((member) => member.email === 'mo@example.com'), { email: 'mo@example.com', role: 'member', devices: [mine, kit, fresh], kit })
})

test('Change keys is saved before its PUT: when the list landed but the answer was lost, the next refresh takes the new key and queues its letters; a letter that fails stays queued', async () => {
  await keysService.forgetHere()
  await keysService.open({ sub: 'dev-zoe', email: 'zoe@example.com' })
  await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const team = await roomKeys.createTeam()
  const ws = team.workspace.id
  const sara = await identity()
  const body = roomKeys.members(ws)
  assert.ok(body)
  const at = Math.max(Date.now(), body.at ?? 0)
  const v2 = await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(team.list), at, members: [...body.members, { email: 'sara@example.com', role: 'member', devices: [toBase64(sara.publicKey)] }], added: { ...body.added, [toBase64(sara.publicKey)]: at } } })
  assert.ok(await roomKeys.advance({ lists: [v2], ws }))
  const { list, room, letters } = await roomKeys.teamChange({ ws, rotate: true })
  await roomKeys.setRotating({ room, letters: letters.map((each) => ({ ...each, workspace: ws })) })
  assert.equal(roomKeys.room(ws)?.workspace.version, 1)
  assert.ok(await roomKeys.advance({ lists: [list], ws }))
  assert.deepEqual([roomKeys.room(ws)?.workspace.version, roomKeys.room(ws)?.workspace.key], [2, room.workspace.key])
  assert.deepEqual(keyStore.current()?.rotating ?? [], [])
  const queued = () => keyStore.current()?.outbox?.some((each) => each.to === toBase64(sara.publicKey))
  assert.ok(queued())
  assert.equal(await roomKeys.post(), 0)
  assert.ok(queued(), 'a letter the cloud refused stays queued')
})

test('an admin revokes an invite: the next list drops it and moves its key to removed, so its link can no longer sign a join', async () => {
  await keysService.forgetHere()
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const boss = await identity()
  const bossKey = toBase64(boss.publicKey)
  const mine = toBase64((await keysService.device()).publicKey)
  const ws = 'TeamRoom0003'
  const at = Date.now() - 1000
  const v1 = await signList({ signer: boss, body: { workspace: ws, version: 1, previous: null, members: [{ email: 'boss@example.com', role: 'owner', devices: [bossKey] }, { email: 'mo@example.com', role: 'admin', devices: [mine] }], invites: [], removed: [], at, added: { [bossKey]: at, [mine]: at } } })
  await roomKeys.addTeam({ ws, list: v1, first: v1 })
  const invited = await roomKeys.invite({ ws, email: 'ana@example.com', role: 'member', name: 'Team' })
  assert.ok(await roomKeys.advance({ lists: [invited.list], ws }))
  const card = await identity(fromBase64(invited.link.split('.').at(-1) ?? ''))
  const ana = toBase64((await identity()).publicKey)
  const joinAfter = async (chain: MemberList[]) => {
    const last = chain.at(-1)
    const body = await check({ anchor: await anchorOf(v1), chain })
    assert.ok(last && body)
    const now = Math.max(Date.now(), body.at ?? 0)
    const join = await signList({ signer: card, body: { ...body, version: body.version + 1, previous: await anchorOf(last), at: now, members: [...body.members, { email: 'ana@example.com', role: 'member', devices: [ana] }], invites: [], removed: [...body.removed.filter((key) => key !== invited.key), invited.key], added: { ...body.added, [ana]: now } } })
    return check({ anchor: await anchorOf(v1), chain: [...chain, join] })
  }
  assert.ok(await joinAfter([v1, invited.list]))
  const revoked = await roomKeys.revoke({ ws, email: 'ana@example.com' })
  const body = await check({ anchor: await anchorOf(v1), chain: [v1, invited.list, revoked] })
  assert.deepEqual([body?.invites, body?.removed], [[], [invited.key]])
  assert.equal(await joinAfter([v1, invited.list, revoked]), null)
  assert.ok(await roomKeys.advance({ lists: [revoked], ws }))
  await assert.rejects(roomKeys.revoke({ ws, email: 'ana@example.com' }), (err: Error & { status?: number }) => err.status === 404)
})
