import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Letter, MemberList, MemberListBody } from '../../src/cloud/cloud.ts'
import { anchorOf, bodyOf, check, signList } from '../../src/cloud/member-list.ts'
import { CloudError } from '../../src/cloud/openhut-cloud.ts'
import { HttpError } from '../../src/http-error.ts'
import { keyring } from '../../src/keyring/keyring.ts'
import { accountDevice, keysService } from '../../src/keyring/keys.ts'
import { roomKeys, type Cloudside } from '../../src/keyring/rooms.ts'
import { useStore, type Stored } from '../../src/keyring/store.ts'
import { fromBase64, identity, newKey, toBase64, type Identity } from '../../src/vault/public.ts'
import { letter, read } from '../../src/vault/secret.ts'

let stored: Stored | undefined
useStore({ deviceName: () => 'Test Mac', store: { machine: 'm', kind: () => 'file', current: () => stored, read: async () => (stored ??= { device: toBase64(newKey()), machine: 'm' }), write: async (next) => { stored = next } } })
const SESSION = { token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
const key = (each: Identity) => toBase64(each.publicKey)
const status = (code: number, message?: RegExp) => (err: Error & { status?: number }) => err instanceof HttpError && err.status === code && (!message || message.test(err.message))
const decode = (plain: Uint8Array | null) => JSON.parse(new TextDecoder().decode(plain ?? new TextEncoder().encode('null'))) as Record<string, unknown> | null

async function signedIn(email = 'mo@example.com') {
  stored = undefined
  const account = await keysService.open({ sub: `sub-${email}`, email })
  await keysService.setSession(SESSION)
  return account
}

async function next({ ws, signer, change }: { ws?: string; signer?: Identity; change: (body: MemberListBody, at: number) => Partial<MemberListBody> }): Promise<MemberList> {
  const room = roomKeys.room(ws)
  const body = bodyOf(room?.list)
  assert.ok(room && body)
  const at = Math.max(Date.now(), (body.at ?? 0) + 1)
  return signList({ signer: signer ?? await keysService.device(), body: { ...body, version: body.version + 1, previous: await anchorOf(room.list), at, ...change(body, at) } })
}

async function grow(input: Parameters<typeof next>[0]): Promise<MemberList> {
  const list = await next(input)
  assert.ok(await roomKeys.advance({ lists: [list], ws: input.ws }))
  return list
}

const joined = (email: string, role: 'owner' | 'admin' | 'member', devices: string[]) => (body: MemberListBody, at: number): Partial<MemberListBody> => ({ members: [...body.members, { email, role, devices }], added: { ...body.added, ...Object.fromEntries(devices.map((each) => [each, at])) } })

async function teamOf({ boss, role, others = [] }: { boss: Identity; role: 'admin' | 'member'; others?: { email: string; role: 'admin' | 'member'; device: Identity }[] }): Promise<{ ws: string; v1: MemberList }> {
  const ws = toBase64(newKey(12))
  const me = await keysService.deviceKey()
  const at = Date.now() - 1000
  const members = [{ email: 'boss@example.com', role: 'owner' as const, devices: [key(boss)] }, { email: 'mo@example.com', role, devices: [me] }, ...others.map((each) => ({ email: each.email, role: each.role, devices: [key(each.device)] }))]
  const v1 = await signList({ signer: boss, body: { workspace: ws, version: 1, previous: null, members, invites: [], removed: [], at, added: Object.fromEntries(members.flatMap((member) => member.devices).map((each) => [each, at])) } })
  await roomKeys.addTeam({ ws, list: v1, first: v1 })
  return { ws, v1 }
}

async function keyLetter({ id, sender, ws, plain, to, purpose = 'workspace-key' }: { id: string; sender: Identity; ws: string; plain: object | Uint8Array<ArrayBuffer>; to?: Uint8Array<ArrayBuffer>; purpose?: 'workspace-key' | 'account-key' }): Promise<Letter> {
  const recipient = to ?? (await keysService.device()).publicKey
  const bytes = plain instanceof Uint8Array ? plain : new TextEncoder().encode(JSON.stringify(plain))
  const body = await letter({ sender, to: recipient, workspace: ws, purpose, version: 1, plain: bytes })
  return { id, object: 'letter', to: toBase64(recipient), from: key(sender), workspace: ws, purpose, body: toBase64(body ?? new Uint8Array()) }
}

function fakeTeam(over: Partial<Cloudside>): Cloudside {
  const ok = async () => ({ status: 200, json: null })
  return { lists: async () => [], letters: async () => [], take: ok, publish: ok, send: ok, ...over }
}

test('advance takes only a chain that follows the room, and nothing for an unknown room or no lists', async () => {
  const account = await signedIn()
  const sara = await identity()
  assert.equal(await roomKeys.advance({ lists: [], ws: account.workspace.id }), null)
  const good = await next({ change: joined('sara@example.com', 'member', [key(sara)]) })
  assert.equal(await roomKeys.advance({ lists: [good], ws: 'unknown' }), null)
  const forged = await next({ signer: sara, change: joined('eve@example.com', 'owner', [key(sara)]) })
  assert.equal(await roomKeys.advance({ lists: [forged] }), null)
  assert.equal(roomKeys.members()?.version, 1)
  assert.equal((await roomKeys.advance({ lists: [good] }))?.version, 2)
})

test('the ring holds the current key and every old one; a room is found by id, or the home room by default', async () => {
  const account = await signedIn()
  assert.deepEqual(Object.keys(roomKeys.ring(account.workspace.id)), ['1'])
  const rotated = await keyring.rotate(account.workspace.id)
  await roomKeys.setRoom(rotated.room)
  assert.deepEqual(roomKeys.ring(account.workspace.id), { 1: fromBase64(account.workspace.key), 2: fromBase64(rotated.room.workspace.key) })
  const team = await roomKeys.createTeam()
  assert.equal(roomKeys.room(team.workspace.id)?.workspace.id, team.workspace.id)
  assert.equal(roomKeys.room()?.workspace.id, account.workspace.id)
  assert.deepEqual(roomKeys.rooms().map((room) => room.workspace.id), [account.workspace.id, team.workspace.id])
  assert.equal(roomKeys.room(team.workspace.id)?.first?.bytes, team.list.bytes)
  assert.deepEqual(roomKeys.ring('unknown'), {})
})

test('inviting again replaces the first invite and keeps the others; a member can’t be invited, and the invite reads back', async () => {
  await signedIn()
  const ws = (await roomKeys.createTeam()).workspace.id
  const sara = await identity()
  await grow({ ws, change: joined('sara@example.com', 'member', [key(sara)]) })
  await assert.rejects(roomKeys.invite({ ws, email: 'sara@example.com', role: 'member', name: 'Team' }), status(409, /already in this team/))
  const ana = await roomKeys.invite({ ws, email: 'ana@example.com', role: 'member', name: 'Team' })
  assert.ok(await roomKeys.advance({ lists: [ana.list], ws }))
  const bob = await roomKeys.invite({ ws, email: 'bob@example.com', role: 'admin', name: 'Team' })
  assert.ok(await roomKeys.advance({ lists: [bob.list], ws }))
  const again = await roomKeys.invite({ ws, email: 'ana@example.com', role: 'admin', name: 'Team' })
  const body = bodyOf(again.list)
  assert.deepEqual(body?.invites.map((each) => [each.email, each.role, each.key]), [['bob@example.com', 'admin', bob.key], ['ana@example.com', 'admin', again.key]])
  assert.deepEqual(body?.removed, [ana.key])
  const secret = again.link.split('.').at(-1) ?? ''
  assert.equal(await keyring.inviteId(secret), again.id)
  const opened = await keyring.readInvite({ team: ws, secret, from: await keysService.deviceKey(), body: again.body })
  assert.deepEqual([opened?.letter.email, opened?.letter.role, opened?.letter.workspace], ['ana@example.com', 'admin', ws])
  assert.equal(await keyring.readInvite({ team: ws, secret: toBase64(newKey()), from: await keysService.deviceKey(), body: again.body }), null)
})

test('an invite link keeps the team name until the hint would pass 430 characters', async () => {
  await signedIn()
  const ws = (await roomKeys.createTeam()).workspace.id
  const hint = (link: string) => new TextDecoder().decode(fromBase64(link.split('#')[1] ?? ''))
  const fixed = `\nmo@example.com\nT`.length
  const fits = `${'a'.repeat(322 - fixed - '@example.com'.length)}@example.com`
  assert.equal(hint((await roomKeys.invite({ ws, email: fits, role: 'member', name: 'T' })).link), `${fits}\nmo@example.com\nT`)
  const over = `a${fits}`
  assert.equal(hint((await roomKeys.invite({ ws, email: over, role: 'member', name: 'T' })).link), over)
})

test('only the owner hands over ownership, never of their own team, and handing it over makes them an admin; making an admin leaves the owner alone', async () => {
  await signedIn()
  const own = keysService.account()?.workspace.id ?? ''
  const boss = await identity()
  const sara = await identity()
  const { ws } = await teamOf({ boss, role: 'admin', others: [{ email: 'sara@example.com', role: 'member', device: sara }] })
  await assert.rejects(roomKeys.withRole({ ws, email: 'sara@example.com', role: 'owner' }), status(403, /^Only the owner can make someone else the owner\.$/))
  await assert.rejects(roomKeys.withRole({ ws, email: 'nobody@example.com', role: 'admin' }), status(404))
  await assert.rejects(roomKeys.withRole({ ws, email: 'boss@example.com', role: 'admin' }), status(403, /owner’s role/))
  await grow({ ws: own, change: joined('sara@example.com', 'member', [key(sara)]) })
  await assert.rejects(roomKeys.withRole({ ws: own, email: 'sara@example.com', role: 'owner' }), status(403, /^Your own team stays yours/))
  const team = (await roomKeys.createTeam()).workspace.id
  await grow({ ws: team, change: joined('sara@example.com', 'member', [key(sara)]) })
  assert.deepEqual(bodyOf(await roomKeys.withRole({ ws: team, email: 'sara@example.com', role: 'admin' }))?.members.map((member) => member.role), ['owner', 'admin'])
  assert.deepEqual(bodyOf(await roomKeys.withRole({ ws: team, email: 'sara@example.com', role: 'owner' }))?.members.map((member) => member.role), ['admin', 'owner'])
})

test('who may remove whom: members remove only their own devices, nobody removes the owner, and the owner can remove from their own team', async () => {
  await signedIn()
  const boss = await identity()
  const [sara, phone] = await Promise.all([identity(), identity()])
  await assert.rejects(keyring.remove({ team: 'unknown', emails: ['x@example.com'] }), status(409))
  const asMember = await teamOf({ boss, role: 'member', others: [{ email: 'sara@example.com', role: 'member', device: sara }] })
  await grow({ ws: asMember.ws, signer: boss, change: (body, at) => ({ members: body.members.map((member) => member.email === 'mo@example.com' ? { ...member, devices: [...member.devices, key(phone)] } : member), added: { ...body.added, [key(phone)]: at } }) })
  await assert.rejects(keyring.remove({ team: asMember.ws, emails: ['sara@example.com'] }), status(403, /remove people/))
  await assert.rejects(keyring.remove({ team: asMember.ws, devices: [key(phone), key(sara)] }), status(403, /someone else’s device/))
  await assert.rejects(keyring.rotate(asMember.ws), status(403, /reset encryption/))
  const mine = bodyOf((await keyring.remove({ team: asMember.ws, devices: [key(phone)] })).list)
  assert.deepEqual(mine?.members.map((member) => member.devices.length), [1, 1, 1])
  assert.deepEqual(mine?.removed, [key(phone)])
  const left = bodyOf((await keyring.remove({ team: asMember.ws, emails: ['mo@example.com'] })).list)
  assert.deepEqual(left?.members.map((member) => member.email), ['boss@example.com', 'sara@example.com'])

  const asAdmin = await teamOf({ boss, role: 'admin', others: [{ email: 'sara@example.com', role: 'member', device: sara }] })
  await assert.rejects(keyring.remove({ team: asAdmin.ws, emails: ['boss@example.com'] }), status(403, /nobody can remove the owner/))
  const cut = bodyOf((await keyring.remove({ team: asAdmin.ws, devices: [key(sara), 'not-listed'] })).list)
  assert.deepEqual([cut?.members.find((member) => member.email === 'sara@example.com')?.devices, cut?.removed], [[], [key(sara)]])

  const home = keysService.account()?.workspace.id ?? ''
  await grow({ ws: home, change: joined('sara@example.com', 'member', [key(sara)]) })
  await assert.rejects(keyring.remove({ team: home, emails: ['mo@example.com'] }), status(403, /someone else the owner/))
  assert.deepEqual(bodyOf((await keyring.remove({ team: home, emails: ['sara@example.com'] })).list)?.members.map((member) => member.email), ['mo@example.com'])
})

test('a room whose list no longer names me can’t be changed', async () => {
  await signedIn()
  const boss = await identity()
  const ws = toBase64(newKey(12))
  const at = Date.now() - 1000
  const v1 = await signList({ signer: boss, body: { workspace: ws, version: 1, previous: null, members: [{ email: 'boss@example.com', role: 'owner', devices: [key(boss)] }], invites: [], removed: [], at, added: { [key(boss)]: at } } })
  await roomKeys.addTeam({ ws, list: v1, first: v1 })
  await assert.rejects(keyring.remove({ team: ws, devices: [key(boss)] }), status(409))
  await assert.rejects(roomKeys.revoke({ ws, email: 'x@example.com' }), status(403))
})

test('an approval letter lets a locked or signed-in Mac into a team only from an admin, for this team, at its key version, naming this Mac', async () => {
  const account = await signedIn()
  const [boss, sara, admin] = await Promise.all([identity(), identity(), identity()])
  const me = await keysService.deviceKey()
  const ws = toBase64(newKey(12))
  const at = Date.now() - 1000
  const members = (mine: string[]) => [{ email: 'boss@example.com', role: 'owner' as const, devices: [key(boss)] }, { email: 'sara@example.com', role: 'member' as const, devices: [key(sara)] }, { email: 'ann@example.com', role: 'admin' as const, devices: [key(admin)] }, { email: 'mo@example.com', role: 'member' as const, devices: mine }]
  const listOf = (id: string, mine: string[]) => signList({ signer: boss, body: { workspace: id, version: 1, previous: null, members: members(mine), invites: [], removed: [], at, added: { [key(boss)]: at, [key(sara)]: at, [key(admin)]: at, ...Object.fromEntries(mine.map((each) => [each, at])) } } })
  const chain = [await listOf(ws, [me])]
  const anchor = await anchorOf(chain[0])
  const teamKey = toBase64(newKey())
  const good = { key: teamKey, version: 1, anchor, vault: 'not-for-a-team' }
  const offers: [string, Letter, MemberList[]][] = [
    ['from a member', await keyLetter({ id: 'm', sender: sara, ws, plain: good }), chain],
    ['unreadable', await keyLetter({ id: 'u', sender: boss, ws, plain: Uint8Array.of(1, 2, 3) }), chain],
    ['another key version', await keyLetter({ id: 'v', sender: boss, ws, plain: { ...good, version: 2 } }), chain],
    ['a wrong anchor', await keyLetter({ id: 'a', sender: boss, ws, plain: { ...good, anchor: toBase64(newKey()) } }), chain],
    ['an account key', await keyLetter({ id: 'k', sender: boss, ws, plain: good, purpose: 'account-key' }), chain],
    ['not naming me', await keyLetter({ id: 'n', sender: boss, ws, plain: good }), [await listOf(ws, [])]],
    ['from a stranger', await keyLetter({ id: 's', sender: await identity(), ws, plain: good }), chain],
  ]
  const other = toBase64(newKey(12))
  const elsewhere = [await listOf(other, [me])]
  offers.push(['another team’s list', await keyLetter({ id: 'o', sender: boss, ws, plain: { ...good, anchor: await anchorOf(elsewhere[0]) } }), elsewhere])
  for (const [why, found, list] of offers) assert.equal(await roomKeys.joinApproved({ ws, chain: list, found: [found] }), false, why)
  assert.equal(roomKeys.room(ws), undefined)
  assert.equal(await roomKeys.joinApproved({ ws, chain, found: [offers[0][1], await keyLetter({ id: 'g', sender: admin, ws, plain: good })] }), true)
  assert.deepEqual([roomKeys.room(ws)?.workspace.key, roomKeys.room(ws)?.list.bytes, keysService.account()?.vault], [teamKey, chain[0].bytes, account.vault])

  await keysService.forgetHere()
  assert.equal(await roomKeys.joinApproved({ ws, chain, found: [await keyLetter({ id: 'g', sender: admin, ws, plain: good })] }), false, 'nobody is signed in here')
  await keysService.setLocked({ sub: 'sub-mo', email: 'mo@example.com' })
  const meNow = await keysService.deviceKey()
  const fresh = [await listOf(ws, [meNow])]
  assert.equal(await roomKeys.joinApproved({ ws, chain: fresh, found: [await keyLetter({ id: 'g', sender: admin, ws, plain: { ...good, anchor: await anchorOf(fresh[0]) } })] }), true)
  assert.deepEqual([stored?.locked, stored?.account?.key, stored?.account?.vault, stored?.account?.workspace.id], [undefined, '', 'not-for-a-team', ws])
})

test('leaving a team drops it and its invite links only; leaving home wipes the keys, or moves to the next team when there is no account key', async () => {
  const account = await signedIn()
  const [a, b] = [await roomKeys.createTeam(), await roomKeys.createTeam()]
  for (const ws of [a.workspace.id, b.workspace.id]) await roomKeys.keepLink({ ws, email: 'x@example.com', link: `link-${ws}`, until: 'u' })
  await roomKeys.dropRoom(a.workspace.id)
  assert.deepEqual(roomKeys.rooms().map((room) => room.workspace.id), [account.workspace.id, b.workspace.id])
  assert.deepEqual([roomKeys.link({ ws: a.workspace.id, email: 'x@example.com' }), roomKeys.link({ ws: b.workspace.id, email: 'x@example.com' }), roomKeys.linkUntil({ ws: b.workspace.id, email: 'x@example.com' })], [undefined, `link-${b.workspace.id}`, 'u'])
  const device = stored?.device
  stored = { ...stored ?? { device: '', machine: 'm' }, account: { ...keysService.account() ?? account, key: '' } }
  await roomKeys.dropRoom(account.workspace.id)
  assert.deepEqual([keysService.account()?.workspace.id, keysService.account()?.teams, stored?.device], [b.workspace.id, [], device])
  await roomKeys.dropRoom(b.workspace.id)
  assert.deepEqual([stored?.account, stored?.locked, stored?.session, stored?.device], [undefined, { sub: account.sub, email: account.email }, SESSION, device])
  await roomKeys.dropRoom('anything')
  await signedIn()
  const keyed = stored?.device
  await roomKeys.dropRoom(keysService.account()?.workspace.id ?? '')
  assert.deepEqual([stored?.account, stored?.locked, stored?.session], [undefined, undefined, undefined])
  assert.notEqual(stored?.device, keyed)
})

test('joining by invite adds me with the invited role, uses up only that invite, and takes me off the removed list', async () => {
  await signedIn('ana@example.com')
  const me = await keysService.deviceKey()
  const boss = await identity()
  const [card, other] = await Promise.all([identity(), identity()])
  const ws = toBase64(newKey(12))
  const at = Date.now() - 1000
  const v1 = await signList({ signer: boss, body: { workspace: ws, version: 1, previous: null, members: [{ email: 'boss@example.com', role: 'owner', devices: [key(boss), me] }], invites: [{ email: 'ana@example.com', role: 'admin', key: key(card) }, { email: 'bob@example.com', role: 'member', key: key(other) }], removed: [], at, added: { [key(boss)]: at, [me]: at } } })
  const v2 = await signList({ signer: boss, body: { ...bodyOf(v1) as MemberListBody, version: 2, previous: await anchorOf(v1), members: [{ email: 'boss@example.com', role: 'owner', devices: [key(boss)] }], added: { [key(boss)]: at }, removed: [me] } })
  const anchor = await anchorOf(v1)
  const list = await roomKeys.joinList({ card, chain: [v1, v2], anchor, ws })
  const body = await check({ anchor, chain: [v1, v2, list] })
  assert.ok(body)
  assert.deepEqual(body.members.at(-1), { email: 'ana@example.com', role: 'admin', devices: [me], viewers: [] })
  assert.deepEqual([body.invites.map((each) => each.email), body.removed, body.added?.[me], body.names?.[me]], [['bob@example.com'], [key(card)], body.at, 'Test Mac'])
  await assert.rejects(roomKeys.joinList({ card: other, chain: [v1, v2], anchor, ws }), status(400))
  await assert.rejects(roomKeys.joinList({ card, chain: [v1, v2], anchor, ws: 'another' }), status(400))
  await assert.rejects(roomKeys.joinList({ card, chain: [v1, v2], anchor: toBase64(newKey()), ws }), status(400))
})

test('taking letters: one at the key I already hold is dropped unused, an account key for a kit not listed yet waits, and my own account key keeps the kit', async () => {
  const account = await signedIn()
  const ws = account.workspace.id
  const laptop = await identity()
  await grow({ change: (body, at) => ({ members: body.members.map((member) => ({ ...member, devices: [...member.devices, key(laptop)] })), added: { ...body.added, [key(laptop)]: at } }) })
  const anchor = await anchorOf(account.list)
  const same = await keyLetter({ id: 'same', sender: laptop, ws, plain: { key: toBase64(newKey()), version: 1, anchor } })
  assert.deepEqual(await roomKeys.takeLetters({ found: [same] }), ['same'])
  assert.equal(roomKeys.room()?.workspace.key, account.workspace.key)
  const future = await keyLetter({ id: 'future', sender: laptop, ws, plain: newKey(), purpose: 'account-key' })
  assert.deepEqual(await roomKeys.takeLetters({ found: [future] }), [])
  assert.equal(keysService.account()?.key, account.key)
  const ownKit = await keyLetter({ id: 'own', sender: laptop, ws, plain: fromBase64(account.key), purpose: 'account-key' })
  await keysService.setKit({ box: 'b', savedAt: 's' })
  assert.deepEqual(await roomKeys.takeLetters({ found: [ownKit] }), ['own'])
  assert.deepEqual(keysService.kitState().saved, { box: 'b', savedAt: 's' }, 'the same account key keeps the kit')
})

test('an account key letter for my new kit replaces the key and forgets the old kit; one for a removed kit is dropped', async () => {
  const account = await signedIn()
  const ws = account.workspace.id
  const laptop = await identity()
  const newAccountKey = newKey()
  const kit = toBase64((await accountDevice(newAccountKey)).publicKey)
  const oldKit = toBase64((await accountDevice(fromBase64(account.key))).publicKey)
  await grow({ change: (body, at) => ({ members: body.members.map((member) => ({ ...member, devices: [...member.devices.filter((each) => each !== oldKit), key(laptop), kit], kit })), removed: [oldKit], added: { ...Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== oldKit)), [key(laptop)]: at, [kit]: at } }) })
  await keysService.setKit({ box: 'b', savedAt: 's' })
  const stale = await keyLetter({ id: 'stale', sender: laptop, ws, plain: fromBase64(account.key), purpose: 'account-key' })
  const fresh = await keyLetter({ id: 'fresh', sender: laptop, ws, plain: newAccountKey, purpose: 'account-key' })
  assert.deepEqual(await roomKeys.takeLetters({ found: [stale, fresh] }), ['stale', 'fresh'])
  assert.deepEqual([keysService.account()?.key, keysService.kitState().saved], [toBase64(newAccountKey), null])
})

test('refresh: a 403 means I’m out; other errors read as nothing new; it asks only for lists after mine and rekeys only when behind', async () => {
  const account = await signedIn()
  const ws = account.workspace.id
  const asked: number[] = []
  let lettersAsked = 0
  const quiet = fakeTeam({ lists: async ({ after }: { after?: number } = {}) => (asked.push(after ?? -1), []), letters: async () => (lettersAsked++, []) })
  assert.deepEqual(await roomKeys.refresh({ ws, team: quiet }), { changed: false, behind: false, gone: false })
  assert.deepEqual([asked, lettersAsked], [[1], 0])
  const gone = fakeTeam({ lists: async () => { throw new CloudError({ status: 403, json: null }) } })
  assert.deepEqual(await roomKeys.refresh({ ws, team: gone }), { changed: false, behind: false, gone: true })
  const down = fakeTeam({ lists: async () => { throw new CloudError({ status: 502, json: null }) } })
  assert.deepEqual(await roomKeys.refresh({ ws, team: down }), { changed: false, behind: false, gone: false })
  const fresh = await roomKeys.refresh({ ws: 'unknown', team: fakeTeam({ lists: async ({ after }: { after?: number } = {}) => (asked.push(after ?? -1), []) }) })
  assert.deepEqual([fresh, asked.at(-1)], [{ changed: false, behind: false, gone: false }, 0])
})

test('an admin welcomes only the people new in a list, with the shared key; a member welcomes nobody', async () => {
  await signedIn()
  const ws = (await roomKeys.createTeam()).workspace.id
  const [sara, ana, anaPhone, phone] = await Promise.all([identity(), identity(), identity(), identity()])
  await grow({ ws, change: joined('sara@example.com', 'member', [key(sara)]) })
  const v3 = await next({ ws, change: (body, at) => ({ members: [...body.members.map((member) => member.email === 'mo@example.com' ? { ...member, devices: [...member.devices, key(phone)] } : member), { email: 'ana@example.com', role: 'member', devices: [key(ana), key(anaPhone)] }], added: { ...body.added, [key(ana)]: at, [key(anaPhone)]: at, [key(phone)]: at } }) })
  const sent: { to: string; body: string }[] = []
  await roomKeys.refresh({ ws, team: fakeTeam({ lists: async () => [v3], send: async (each) => (sent.push(each), { status: 200, json: null }) }) })
  assert.deepEqual(sent.map((each) => each.to).sort(), [key(ana), key(anaPhone)].sort())
  const me = await keysService.device()
  const plain = decode(await read({ recipient: ana, from: me.publicKey, workspace: ws, purpose: 'workspace-key', body: fromBase64(sent.find((each) => each.to === key(ana))?.body ?? ''), allowed: [me.publicKey] }))
  assert.deepEqual([plain?.key, plain?.own, plain?.vault], [roomKeys.room(ws)?.workspace.key, undefined, undefined])

  const boss = await identity()
  const { ws: theirs } = await teamOf({ boss, role: 'member' })
  const v2 = await next({ ws: theirs, signer: boss, change: joined('bob@example.com', 'member', [key(await identity())]) })
  sent.length = 0
  await roomKeys.refresh({ ws: theirs, team: fakeTeam({ lists: async () => [v2], send: async (each) => (sent.push(each), { status: 200, json: null }) }) })
  assert.deepEqual(sent, [])
})

test('in a team, my kit entry follows home: it is added once, a device home removed is dropped too, and nothing is published when all is in step', async () => {
  await signedIn()
  const boss = await identity()
  const laptop = await identity()
  const home = keysService.account()?.workspace.id ?? ''
  await grow({ ws: home, change: (body, at) => ({ members: body.members.map((member) => ({ ...member, devices: [...member.devices, key(laptop)] })), added: { ...body.added, [key(laptop)]: at } }) })
  const { ws } = await teamOf({ boss, role: 'member' })
  await grow({ ws, signer: boss, change: (body, at) => ({ members: body.members.map((member) => member.email === 'mo@example.com' ? { ...member, devices: [...member.devices, key(laptop)] } : member), added: { ...body.added, [key(laptop)]: at } }) })
  const puts: MemberList[] = []
  const team = fakeTeam({ publish: async ({ list }) => (puts.push(list), { status: 200, json: null }) })
  await roomKeys.refresh({ ws: home, team })
  assert.equal(puts.length, 0, 'home lists no kit of its own here')
  await roomKeys.refresh({ ws, team })
  assert.equal(puts.length, 1)
  await roomKeys.refresh({ ws, team })
  assert.equal(puts.length, 1, 'in step: nothing to publish')
  await grow({ ws: home, change: (body) => ({ members: body.members.map((member) => ({ ...member, devices: member.devices.filter((each) => each !== key(laptop)) })), removed: [...body.removed, key(laptop)], added: Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== key(laptop))) }) })
  await roomKeys.refresh({ ws, team })
  assert.equal(puts.length, 2)
  const mine = bodyOf(puts[1])?.members.find((member) => member.email === 'mo@example.com')
  const kit = await keysService.accountDeviceKey()
  assert.deepEqual(mine?.devices, [await keysService.deviceKey(), kit])
  assert.equal(mine?.kit, kit)
})
