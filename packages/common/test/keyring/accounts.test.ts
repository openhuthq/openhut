import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MemberList, MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, bodyOf, signList } from '../../src/cloud/member-list.ts'
import { HttpError } from '../../src/http-error.ts'
import { keyring } from '../../src/keyring/keyring.ts'
import { keysService } from '../../src/keyring/keys.ts'
import { roomKeys } from '../../src/keyring/rooms.ts'
import { deviceName, useStore, type Stored } from '../../src/keyring/store.ts'
import { fromBase64, identity, newKey, toBase64, type Identity } from '../../src/vault/public.ts'
import { letter, read } from '../../src/vault/secret.ts'

let stored: Stored | undefined
useStore({ deviceName: () => 'Test Mac', store: { machine: 'm', kind: () => 'file', current: () => stored, read: async () => (stored ??= { device: toBase64(newKey()), machine: 'm' }), write: async (next) => { stored = next } } })
const current = (): Stored | undefined => stored
const SESSION = { token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
const key = (each: Identity) => toBase64(each.publicKey)
const status = (code: number, message?: RegExp) => (err: Error & { status?: number }) => err instanceof HttpError && err.status === code && (!message || message.test(err.message))

async function signedIn(email = 'mo@example.com') {
  stored = undefined
  const account = await keysService.open({ sub: `sub-${email}`, email })
  await keysService.setSession(SESSION)
  return account
}

async function grow({ ws, signer, change }: { ws?: string; signer?: Identity; change: (body: MemberListBody, at: number) => Partial<MemberListBody> }): Promise<MemberList> {
  const room = roomKeys.room(ws)
  const body = bodyOf(room?.list)
  assert.ok(room && body)
  const at = Math.max(Date.now(), (body.at ?? 0) + 1)
  const list = await signList({ signer: signer ?? await keysService.device(), body: { ...body, version: body.version + 1, previous: await anchorOf(room.list), at, ...change(body, at) } })
  assert.ok(await roomKeys.advance({ lists: [list], ws }))
  return list
}

const joined = (email: string, role: 'owner' | 'admin' | 'member', devices: string[]) => (body: MemberListBody, at: number): Partial<MemberListBody> => ({ members: [...body.members, { email, role, devices }], added: { ...body.added, ...Object.fromEntries(devices.map((each) => [each, at])) } })

test('asked rooms round-trip, and an empty list clears them', async () => {
  await signedIn()
  assert.deepEqual(keysService.asked(), [])
  await keysService.setAsked([{ id: 'w1', admins: ['a'], own: true }])
  assert.deepEqual(keysService.asked(), [{ id: 'w1', admins: ['a'], own: true }])
  await keysService.setAsked([])
  assert.equal(stored?.asking, undefined)
  assert.deepEqual(keysService.asked(), [])
})

test('the vault key is the account’s, and a signed-out Mac has none; the device is named in the first list', async () => {
  const account = await signedIn()
  assert.deepEqual(keysService.vault(), fromBase64(account.vault ?? ''))
  assert.equal(bodyOf(account.list)?.names?.[await keysService.deviceKey()], 'Test Mac')
  assert.equal(deviceName(), 'Test Mac')
  await keysService.forgetHere()
  assert.equal(keysService.vault(), null)
})

test('signedIn needs an account and a session; mustBeOn also needs the account key', async () => {
  stored = undefined
  assert.throws(() => keysService.signedIn(), status(409, /Sign in/))
  assert.throws(() => keysService.mustBeOn(), status(409, /Enable OpenHut Cloud/))
  const account = await signedIn()
  assert.equal(keysService.signedIn(), keysService.account())
  assert.equal(keysService.mustBeOn(), keysService.account())
  await keysService.setSession(undefined)
  assert.throws(() => keysService.signedIn(), status(409, /Sign in/))
  assert.throws(() => keysService.mustBeOn(), status(409))
  stored = { ...stored ?? { device: '', machine: 'm' }, session: SESSION, account: { ...account, key: '' } }
  assert.equal(keysService.signedIn().email, 'mo@example.com')
  assert.throws(() => keysService.mustBeOn(), status(409))
})

test('removed here keeps who you are, and does nothing on a Mac that never signed in', async () => {
  stored = undefined
  const device = (await keyStoreRead()).device
  await keysService.removedHere()
  assert.equal(current()?.device, device)
  await keysService.setLocked({ sub: 'sub-mo', email: 'mo@example.com' })
  await keysService.removedHere()
  assert.notEqual(current()?.device, device)
  assert.deepEqual(current()?.locked, { sub: 'sub-mo', email: 'mo@example.com' })
  const account = await signedIn()
  const before = current()?.device
  await keysService.removedHere()
  assert.notEqual(current()?.device, before)
  assert.deepEqual([current()?.account, current()?.locked], [undefined, { sub: account.sub, email: account.email }])
})

test('a Mac locked for one account refuses another, and opens for the same one', async () => {
  stored = undefined
  await keysService.setLocked({ sub: 'sub-mo', email: 'mo@example.com' })
  assert.throws(() => keysService.ownedBy({ sub: 'sub-ana' }), status(409, /set up for mo@example\.com/))
  keysService.ownedBy({ sub: 'sub-mo' })
})

test('adding a device lists it under me only, as a runtime unless told otherwise, with its name and the time it was added', async () => {
  await signedIn()
  const [server, mac, other] = await Promise.all([identity(), identity(), identity()])
  await grow({ change: joined('ana@example.com', 'member', [key(other)]) })
  const added = bodyOf(await keysService.addDevice({ device: key(server), name: 'x'.repeat(80) }) ?? undefined)
  assert.ok(added)
  assert.deepEqual(added.members.map((member) => member.devices.includes(key(server))), [true, false])
  assert.deepEqual([added.runtimes, added.names?.[key(server)], added.added?.[key(server)]], [[key(server)], 'x'.repeat(64), added.at])
  assert.ok((added.at ?? 0) > 0)
  const plain = bodyOf(await keysService.addDevice({ device: key(mac), name: null, runtime: false }) ?? undefined)
  assert.deepEqual([plain?.runtimes, plain?.names?.[key(mac)]], [undefined, undefined])
  assert.equal(await keysService.addDevice({ device: key(other), name: null }), null, 'a device already on the list')
  stored = undefined
  assert.equal(await keysService.addDevice({ device: key(mac), name: null }), null)
})

test('Not me refuses a list that also names this Mac, and drops a runtime added at the same moment as the stolen device', async () => {
  await signedIn()
  const [stolen, planted] = await Promise.all([identity(), identity()])
  const me = await keysService.deviceKey()
  const at = Date.now() + 1000
  await grow({ change: (body) => ({ at, members: body.members.map((member) => ({ ...member, devices: [...member.devices, key(stolen), key(planted)] })), runtimes: [key(planted)], added: { ...body.added, [key(stolen)]: at, [key(planted)]: at } }) })
  await assert.rejects(keysService.dropDevices([key(stolen), me]), status(400))
  await assert.rejects(keysService.dropDevices([]), status(400))
  const body = bodyOf(await keysService.dropDevices([key(stolen)]))
  assert.deepEqual([body?.removed.includes(key(stolen)), body?.removed.includes(key(planted)), body?.removed.includes(me)], [true, true, false])
})

test('the account key brings back the vault key and own key; a Mac still on the list restores without a new list', async () => {
  const account = await signedIn()
  const sara = await identity()
  const pinned = toBase64(newKey())
  await roomKeys.setRoom({ ...account, workspace: { ...account.workspace, own: pinned } })
  await grow({ change: joined('sara@example.com', 'admin', [key(sara)]) })
  const now = keysService.account()
  assert.ok(now)
  const chain = [account.list, now.list]
  const boxes = [{ id: now.workspace.id, key: (await keysService.workspaceBox({ account: now })).body, chain }]
  await keysService.relock({ sub: now.sub, email: now.email })
  const back = await keysService.restoreWith({ key: fromBase64(now.key), workspaces: boxes })
  assert.ok(back)
  assert.deepEqual([back.vault, back.workspace.own, back.list.bytes], [account.vault, pinned, now.list.bytes])
  assert.deepEqual(bodyOf(back.list)?.members.find((member) => member.email === 'sara@example.com')?.devices, [key(sara)])
})

test('a fresh Mac joins only my member entry, and a team box can’t stand in for the home box', async () => {
  const account = await signedIn()
  const sara = await identity()
  await grow({ change: joined('sara@example.com', 'admin', [key(sara)]) })
  const now = keysService.account()
  assert.ok(now)
  const chain = [account.list, now.list]
  const team = await roomKeys.createTeam()
  const home = { id: now.workspace.id, key: (await keysService.workspaceBox({ account: now })).body, chain }
  const teamBox = { id: team.workspace.id, key: (await keysService.workspaceBox({ account: now, room: team })).body, chain: [team.list] }
  await keysService.forgetHere()
  await keysService.setLocked({ sub: now.sub, email: now.email })
  assert.equal(await keysService.restoreWith({ key: fromBase64(now.key), workspaces: [teamBox] }), null)
  const back = await keysService.restoreWith({ key: fromBase64(now.key), workspaces: [home, teamBox] })
  const body = bodyOf(back?.list)
  const me = await keysService.deviceKey()
  assert.deepEqual(body?.members.map((member) => member.devices.includes(me)), [true, false])
  assert.equal(body?.added?.[me], body?.at)
  assert.equal(back?.teams, undefined, 'my kit isn’t listed in the team, so the team box doesn’t open it')
})

test('restore by an approval letter, and signedHere tells who signed the restored list', async () => {
  const account = await signedIn()
  const boxes = [{ id: account.workspace.id, key: (await keysService.workspaceBox({ account })).body, chain: [account.list] }]
  const oldMac = await keysService.device()
  await keysService.forgetHere()
  await keysService.setLocked({ sub: account.sub, email: account.email })
  let fetched = 0
  const workspaces = async () => (fetched++, boxes)
  const body = await lockLetter({ sender: oldMac, plain: fromBase64(account.key), workspace: account.workspace.id })
  const letter = { id: 'l1', object: 'letter' as const, to: await keysService.deviceKey(), from: key(oldMac), workspace: account.workspace.id, purpose: 'account-key' as const, body }
  assert.equal(await keyring.restore({ from: { letter: { ...letter, body: toBase64(newKey(90)) }, workspace: account.workspace.id }, workspaces }), null)
  assert.equal(fetched, 0, 'boxes are fetched only once the key opens')
  const back = await keyring.restore({ from: { letter, workspace: account.workspace.id }, workspaces })
  assert.equal(back?.key, account.key)
  assert.equal(await keyring.signedHere(back ?? account), true)
  assert.equal(await keyring.signedHere(account), false)
})

test('approving my own server lists it as a runtime and hands it the own and vault keys; approving a teammate hands only the team key', async () => {
  const account = await signedIn()
  const [server, sara, saraMac] = await Promise.all([identity(), identity(), identity()])
  await grow({ change: joined('sara@example.com', 'member', [key(sara)]) })
  const mine = await keyring.approve({ team: account.workspace.id, email: account.email, device: key(server), name: 'Server' })
  assert.deepEqual(bodyOf(mine.list)?.runtimes, [key(server)])
  const me = await keysService.device()
  const opened = (to: Identity, body: string) => read({ recipient: to, from: me.publicKey, workspace: account.workspace.id, purpose: 'workspace-key', body: fromBase64(body), allowed: [me.publicKey] })
  const secret = JSON.parse(new TextDecoder().decode(await opened(server, mine.letter.body) ?? new Uint8Array())) as Record<string, unknown>
  assert.ok(secret.own && secret.vault)
  assert.ok(await roomKeys.advance({ lists: [mine.list] }))
  await assert.rejects(keyring.approve({ team: account.workspace.id, email: account.email, device: key(server), name: null }), status(409, /already on your account/))
  const theirs = await keyring.approve({ team: account.workspace.id, email: 'sara@example.com', device: key(saraMac), name: 'Sara’s Mac' })
  const shared = JSON.parse(new TextDecoder().decode(await opened(saraMac, theirs.letter.body) ?? new Uint8Array())) as Record<string, unknown>
  assert.deepEqual([shared.own, shared.vault, shared.key], [undefined, undefined, account.workspace.key])
  const body = bodyOf(theirs.list)
  assert.deepEqual([body?.added?.[key(saraMac)], body?.names?.[key(saraMac)]], [body?.at, 'Sara’s Mac'])
  assert.ok(!body?.runtimes?.includes(key(saraMac)), 'a teammate’s Mac is not a server')
  assert.ok(await roomKeys.advance({ lists: [theirs.list] }))
  const saraServer = await identity()
  const box = await keyring.approve({ team: account.workspace.id, email: 'sara@example.com', device: key(saraServer), name: 'hermes-agents', server: true })
  assert.ok(bodyOf(box.list)?.runtimes?.includes(key(saraServer)), 'a server that knocked as a server is on the runtimes, so it shows as a server')
})

test('lock and unlock use the team key; an unknown team locks nothing, and words locked before a rotation still open after it', async () => {
  const account = await signedIn()
  const ws = account.workspace.id
  const plain = Uint8Array.of(1, 2, 3)
  assert.equal(await keyring.lock({ team: 'nope', bind: 'b', plain }), null)
  const before = await keyring.lock({ team: ws, bind: 'b', plain })
  assert.ok(before)
  const rotated = await keyring.rotate(ws)
  await roomKeys.setRoom(rotated.room)
  assert.deepEqual(await keyring.unlock({ team: ws, bind: 'b', body: before }), plain)
  const after = await keyring.lock({ team: ws, bind: 'b', plain })
  assert.deepEqual(await keyring.unlock({ team: ws, bind: 'b', body: after ?? '' }), plain)
  assert.equal(await keyring.unlock({ team: 'nope', bind: 'b', body: after ?? '' }), null)
})

test('Change keys sends my own devices the own key, and nobody else', async () => {
  const account = await signedIn()
  const [phone, sara] = await Promise.all([identity(), identity()])
  await grow({ change: (body, at) => ({ members: [...body.members.map((member) => ({ ...member, devices: [...member.devices, key(phone)] })), { email: 'sara@example.com', role: 'member', devices: [key(sara)] }], added: { ...body.added, [key(phone)]: at, [key(sara)]: at } }) })
  const { letters } = await keysService.change()
  const me = await keysService.device()
  const open = async (to: Identity) => {
    const sent = letters.find((each) => each.to === key(to) && each.purpose === 'workspace-key')
    const plain = sent && await read({ recipient: to, from: me.publicKey, workspace: account.workspace.id, purpose: 'workspace-key', body: fromBase64(sent.body), allowed: [me.publicKey] })
    return JSON.parse(new TextDecoder().decode(plain ?? new Uint8Array())) as Record<string, unknown>
  }
  assert.ok((await open(phone)).own)
  assert.equal((await open(sara)).own, undefined)
})

test('a sealed record opens back with each part under its own key, and another account can’t open the own or vault parts', async () => {
  const account = await signedIn()
  const where = { collection: 'agent' as const, workspace: account.workspace.id, parent: 'mo@example.com', id: 'ag_seal0001' }
  const value = { workspace: { name: 'w' }, own: { notes: 'o' }, vault: { token: 'v' } }
  const put = await (await keyring.sealer()).seal({ where, ver: 1, value })
  assert.ok(put)
  const row = { id: where.id, object: where.collection, ...put }
  const opened = await (await keyring.sealer()).open(row)
  assert.deepEqual([opened?.value, [...opened?.sealedWith ?? []].sort()], [value, ['own', 'vault', 'workspace']])
  stored = { ...stored ?? { device: '', machine: 'm' }, account: { ...account, key: toBase64(newKey()), vault: toBase64(newKey()) } }
  const partial = await (await keyring.sealer()).open(row)
  assert.deepEqual(partial?.value.workspace, value.workspace)
  assert.equal(partial?.value.own, undefined)
  assert.equal(partial?.value.vault, undefined)
})

async function keyStoreRead(): Promise<Stored> {
  stored ??= { device: toBase64(newKey()), machine: 'm' }
  return stored
}

async function lockLetter({ sender, plain, workspace }: { sender: Identity; plain: Uint8Array<ArrayBuffer>; workspace: string }): Promise<string> {
  const body = await letter({ sender, to: (await keysService.device()).publicKey, workspace, purpose: 'account-key', version: 1, plain })
  return toBase64(body ?? new Uint8Array())
}

