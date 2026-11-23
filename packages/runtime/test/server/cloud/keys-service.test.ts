import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, db } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal, unseal } from '../../../src/server/platform/secrets.ts'
import { accountDevice, keysService, openLetter } from '../../../src/server/cloud/keys-service.ts'
import { keyStore } from '../../../src/server/cloud/key-store.ts'
import { roomKeys } from '../../../src/server/cloud/room-keys.ts'
import { fromBase64, identity, letter, lock, newKey, read, slot, toBase64, unlock } from '@openhut/common/vault/vault.ts'
import { anchorOf, bodyOf, check, signList } from '@openhut/common/cloud/member-list.ts'

await migrate()
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const stored = () => JSON.parse(unseal(readFileSync(FILE, 'utf8'))) as { device: string; machine: string; account: { key: string; workspace: { key: string } } }

test('keys are stored only sealed, in a file only you can read when there is no keychain', async () => {
  assert.equal(keyStore.kind(), 'file')
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  await keysService.setKit({ box: kit.box, savedAt: new Date().toISOString() })
  const raw = readFileSync(FILE, 'utf8')
  assert.equal(statSync(FILE).mode & 0o777, 0o600)
  const { device, account } = stored()
  const rows = JSON.stringify(await db.selectFrom('install_setting').selectAll().execute())
  for (const secret of [device, account.key, account.workspace.key, Buffer.from(fromBase64(account.key)).toString('hex'), kit.words.join(' ')]) {
    assert.equal(raw.includes(secret), false)
    assert.equal(rows.includes(secret), false)
  }
})

test('a signed-out Mac unlocks with the 12 words: the kit box opens the account key, the first workspace box it opens gives the key, and the account key signs this Mac in', async () => {
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  await keysService.setKit({ box: kit.box, savedAt: new Date().toISOString() })
  const mine = { id: account.workspace.id, key: (await keysService.workspaceBox({ account })).body, chain: [account.list] }
  const foreign = { ...mine, id: 'another_ws', key: (await keysService.workspaceBox({ account: { ...account, key: toBase64(newKey()) } })).body }
  const saved = { kit: keysService.kitState().saved?.box ?? '', workspaces: [foreign, mine] }
  await keysService.setSession(undefined)
  await keysService.forgetHere()
  await keysService.setLocked({ sub: 'dev-mo', email: 'mo@example.com' })
  const typo = [...kit.words].reverse()
  assert.equal(await keysService.restore({ words: typo, ...saved }), null)
  assert.equal(await keysService.restore({ words: kit.words, ...saved, workspaces: [foreign, { ...mine, id: 'renamed_ws' }] }), null)
  const restored = await keysService.restore({ words: kit.words, ...saved })
  assert.equal(restored?.key, account.key)
  assert.equal(restored?.workspace.key, account.workspace.key)
  const body = await check({ anchor: await anchorOf(account.list), chain: [account.list, restored?.list ?? account.list] })
  assert.equal(body?.version, 2)
  assert.ok(body?.members[0].devices.includes(toBase64((await keysService.device()).publicKey)))
})

test('key boxes are signed by the account key, and a box another account key made isn’t mine', async () => {
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const box = await keysService.workspaceBox({ account })
  const workspace = box.name
  const at = (made: { savedAt: number }) => new Date(made.savedAt).toISOString()
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: box.body, by: box.by, signature: box.signature, savedAt: at(box) } }), true)
  const other = { ...account, key: toBase64(newKey()) }
  const theirs = await keysService.workspaceBox({ account: other })
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: theirs.body, by: theirs.by, signature: theirs.signature, savedAt: at(theirs) } }), false)
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: theirs.body, by: box.by, signature: box.signature, savedAt: at(box) } }), false)
  const savedAt = Date.now()
  const kit = { ...await keysService.signBox({ account, name: 'kit', body: box.body, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal(await keysService.boxIsMine({ account, name: 'kit', box: kit }), true)
  assert.equal(await keysService.boxIsMine({ account, name: 'kit', box: { ...kit, savedAt: new Date(savedAt + 1).toISOString() } }), false)
  assert.equal(await keysService.boxIsMine({ account, name: 'passkey', box: kit }), false)
  assert.equal(await keysService.boxIsMine({ account: other, name: 'kit', box: kit }), false)
  const made = await keysService.signBox({ account, name: 'passkey', body: toBase64(newKey()), savedAt: Date.now() })
  const passkey = { ...made, savedAt: new Date(made.savedAt).toISOString() }
  assert.equal(await keysService.boxIsMine({ account, name: 'passkey', box: passkey }), true, 'a real passkey box stays mine, so Touch ID keeps reading On')
  assert.equal(await keysService.boxIsMine({ account: other, name: 'passkey', box: passkey }), false)
})

test('signing in with another Google account is refused, and the first account keeps its keys and kit', async () => {
  const mo = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setKit({ box: (await keysService.newKit()).box, savedAt: new Date().toISOString() })
  const kit = keysService.kitState().saved
  await assert.rejects(keysService.open({ sub: 'dev-sara', email: 'sara@example.com' }), (err: Error & { status?: number }) => err.status === 409 && /is set up for mo@example\.com\. Sign in with that account\./.test(err.message))
  assert.deepEqual(keysService.account(), mo)
  assert.deepEqual(keysService.kitState().saved, kit)
})

test('a new Mac opens an approval letter only when it is sealed to its own key for its own workspace, then restores with the account key in it', async () => {
  const oldMac = await identity()
  const accountKey = newKey()
  const kit = await identity(fromBase64(await slot({ key: accountKey, path: 'account-device' })))
  const workspaceKey = newKey()
  const at = Date.now() - 24 * 60 * 60_000
  const devices = [toBase64(oldMac.publicKey), toBase64(kit.publicKey)]
  const genesis = await signList({ signer: oldMac, body: { workspace: 'ws_paired01', version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices, kit: devices[1] }], invites: [], removed: [], at, added: Object.fromEntries(devices.map((each) => [each, at])) } })
  const secret = new TextEncoder().encode(JSON.stringify({ key: toBase64(workspaceKey), version: 1, anchor: await anchorOf(genesis) }))
  const box = toBase64(await lock({ key: accountKey, version: 1, bind: 'account/dev-mo/workspace/ws_paired01', plain: secret }) ?? new Uint8Array())
  await keysService.relock({ sub: 'dev-mo', email: 'mo@example.com' })
  const me = (await keysService.device()).publicKey
  const someoneElse = await identity()
  const sealed = async ({ to = me, workspace = 'ws_paired01', purpose = 'account-key' as const }: { to?: Uint8Array<ArrayBuffer>; workspace?: string; purpose?: 'account-key' | 'workspace-key' } = {}) => {
    const body = await letter({ sender: oldMac, to, workspace, purpose, version: 1, plain: accountKey })
    return { id: 'letter01', object: 'letter' as const, to: toBase64(me), from: toBase64(oldMac.publicKey), workspace: 'ws_paired01', purpose: 'account-key' as const, body: toBase64(body ?? new Uint8Array()) }
  }
  assert.equal(await openLetter({ found: await sealed({ to: someoneElse.publicKey }), workspace: 'ws_paired01' }), null)
  assert.equal(await openLetter({ found: await sealed({ workspace: 'ws_wrong001' }), workspace: 'ws_paired01' }), null)
  assert.equal(await openLetter({ found: await sealed({ purpose: 'workspace-key' }), workspace: 'ws_paired01' }), null)
  assert.deepEqual(await openLetter({ found: await sealed(), workspace: 'ws_paired01' }), accountKey)
  const account = await keysService.restoreWith({ key: accountKey, workspaces: [{ id: 'ws_paired01', key: box, chain: [genesis] }] })
  assert.ok(account)
  const joined = await check({ anchor: await anchorOf(genesis), chain: [genesis, account.list] })
  assert.deepEqual(joined?.members[0].devices, [...devices, toBase64(me)])
  assert.equal(account.list.by, devices[1])
  await keysService.adopt({ account })
})

test('Not me drops the device from the member list in one version and changes no key; Change keys makes a new workspace key and account key that the removed Mac never gets', async () => {
  await keysService.setSession(undefined)
  await keysService.relock({ sub: 'dev-mo', email: 'mo@example.com' })
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const [stolen, phone] = await Promise.all([identity(), identity()])
  const body = roomKeys.members()
  assert.ok(body)
  const at = Date.now()
  const mine = body.members[0]
  const added = await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(account.list), at, members: [{ ...mine, devices: [...mine.devices, toBase64(stolen.publicKey), toBase64(phone.publicKey)] }], added: { ...body.added, [toBase64(stolen.publicKey)]: at, [toBase64(phone.publicKey)]: at } } })
  assert.ok(await roomKeys.advance({ lists: [added] }))
  await assert.rejects(keysService.dropDevices([mine.kit ?? '']), (err: Error & { status?: number }) => err.status === 400)
  const dropped = await keysService.dropDevices([toBase64(stolen.publicKey)])
  const without = await check({ anchor: await anchorOf(account.list), chain: [account.list, added, dropped] })
  assert.ok(without)
  assert.equal(without.keyVersion ?? 1, 1)
  assert.ok(without.removed.includes(toBase64(stolen.publicKey)))
  assert.equal(without.members[0].kit, mine.kit)
  assert.ok(await roomKeys.advance({ lists: [dropped] }))
  assert.equal(keysService.account()?.key, account.key)
  const oldKey = fromBase64(account.workspace.key)
  const { list, next, letters } = await keysService.change()
  const after = await check({ anchor: await anchorOf(account.list), chain: [account.list, added, dropped, list] })
  assert.ok(after)
  assert.equal(after.keyVersion, 2)
  assert.ok(after.removed.includes(mine.kit ?? ''))
  assert.equal(after.members[0].kit, toBase64((await accountDevice(fromBase64(next.key))).publicKey))
  assert.notEqual(next.key, account.key)
  assert.deepEqual(next.workspace.old, { 1: account.workspace.key })
  assert.equal(letters.some((each) => each.to === toBase64(stolen.publicKey)), false)
  const locked = await lock({ key: fromBase64(next.workspace.key), version: 2, bind: 'workspace/ws/record/after', plain: new TextEncoder().encode('made after Change keys') })
  assert.ok(locked)
  assert.equal(await unlock({ keys: { 1: oldKey, 2: oldKey }, bind: 'workspace/ws/record/after', locked }), null)
  const toPhone = letters.find((each) => each.to === toBase64(phone.publicKey) && each.purpose === 'workspace-key')
  assert.ok(toPhone)
  const plain = await read({ recipient: phone, from: (await keysService.device()).publicKey, workspace: account.workspace.id, purpose: 'workspace-key', body: fromBase64(toPhone.body), allowed: [(await keysService.device()).publicKey] })
  const secret = plain && JSON.parse(new TextDecoder().decode(plain)) as { key: string; version: number }
  assert.equal(secret?.version, 2)
  assert.deepEqual(new TextDecoder().decode(await unlock({ keys: { 2: fromBase64(secret?.key ?? '') }, bind: 'workspace/ws/record/after', locked }) ?? new Uint8Array()), 'made after Change keys')
  assert.ok(letters.some((each) => each.to === toBase64(phone.publicKey) && each.purpose === 'account-key'))
})

test('Not me also drops runtimes added at or after the removed device, so a runtime it planted is cut off too', async () => {
  const account = keysService.mustBeOn()
  const [kept, stolen, planted] = await Promise.all([identity(), identity(), identity()])
  const [k, s, p] = [kept, stolen, planted].map((each) => toBase64(each.publicKey))
  const body = roomKeys.members()
  assert.ok(body)
  const t1 = Math.max(Date.now(), body.at ?? 0) + 1000
  const grow = async ({ signer, at, device, runtime }: { signer: Awaited<ReturnType<typeof identity>>; at: number; device: string; runtime: boolean }) => {
    const now = roomKeys.members()
    const me = now?.members.find((member) => member.email === account.email)
    assert.ok(now && me)
    const list = await signList({ signer, body: { ...now, version: now.version + 1, previous: await anchorOf(keysService.account()?.list ?? account.list), at, members: now.members.map((member) => member === me ? { ...me, devices: [...me.devices, device] } : member), runtimes: runtime ? [...now.runtimes ?? [], device] : now.runtimes, added: { ...now.added, [device]: at } } })
    assert.ok(await roomKeys.advance({ lists: [list] }))
  }
  await grow({ signer: await keysService.device(), at: t1, device: k, runtime: true })
  await grow({ signer: await keysService.device(), at: t1 + 1, device: s, runtime: false })
  await grow({ signer: stolen, at: t1 + 4 * 24 * 60 * 60_000, device: p, runtime: true })
  const list = await keysService.dropDevices([s])
  const body2 = JSON.parse(new TextDecoder().decode(fromBase64(list.bytes))) as { removed: string[]; runtimes: string[] }
  assert.deepEqual([body2.removed.includes(s), body2.removed.includes(p), body2.removed.includes(k)], [true, true, false])
  assert.deepEqual(body2.runtimes, [k])
})

test('taking letters returns the used, stale, unreadable and strangers’ letters to delete, and keeps one for a newer key', async () => {
  await keysService.setSession(undefined)
  await keysService.relock({ sub: 'dev-mo', email: 'mo@example.com' })
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const [other, stranger] = await Promise.all([identity(), identity()])
  const body = roomKeys.members()
  assert.ok(body)
  const me = (await keysService.device()).publicKey
  const t1 = Math.max(Date.now(), body.at ?? 0) + 1000
  const v2 = await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(account.list), at: t1, members: [{ ...body.members[0], devices: [...body.members[0].devices, toBase64(other.publicKey)] }], added: { ...body.added, [toBase64(other.publicKey)]: t1 } } })
  const v3 = await signList({ signer: other, body: { ...body, version: 3, previous: await anchorOf(v2), at: t1 + 4 * 24 * 60 * 60_000, keyVersion: 2, members: [{ ...body.members[0], devices: [...body.members[0].devices, toBase64(other.publicKey)] }], added: { ...body.added, [toBase64(other.publicKey)]: t1 } } })
  assert.ok(await roomKeys.advance({ lists: [v2, v3] }))
  const anchor = await anchorOf(account.list)
  const sent = async ({ id, sender, version }: { id: string; sender: typeof other; version: number }) => {
    const plain = new TextEncoder().encode(JSON.stringify({ key: toBase64(newKey()), version, anchor }))
    const body = await letter({ sender, to: me, workspace: account.workspace.id, purpose: 'workspace-key', version: 1, plain })
    return { id, object: 'letter' as const, to: toBase64(me), from: toBase64(sender.publicKey), workspace: account.workspace.id, purpose: 'workspace-key' as const, body: toBase64(body ?? new Uint8Array()) }
  }
  const garbage = { ...await sent({ id: 'garbage', sender: other, version: 2 }), body: toBase64(newKey(80)) }
  const done = await roomKeys.takeLetters({ found: [await sent({ id: 'old', sender: other, version: 1 }), await sent({ id: 'future', sender: other, version: 3 }), garbage, await sent({ id: 'stranger', sender: stranger, version: 2 }), await sent({ id: 'used', sender: other, version: 2 })] })
  assert.deepEqual(done.sort(), ['garbage', 'old', 'stranger', 'used'])
  assert.equal(keysService.account()?.workspace.version, 2)
})

test('an admin lets a new device in with no words, and your own approval letter carries the account key only to that device; removing someone from a team drops them without a key change; Change keys rotates, and the removed member can’t read anything written after', async () => {
  await keysService.setSession(undefined)
  await keysService.relock({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const team = await roomKeys.createTeam()
  const ws = team.workspace.id
  const [sara, ana, anaMac] = await Promise.all([identity(), identity(), identity()])
  const key = (each: typeof sara) => toBase64(each.publicKey)
  const body = bodyOf(team.list)
  assert.ok(body)
  const at = Math.max(Date.now(), body.at ?? 0)
  const v2 = await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(team.list), at, members: [...body.members, { email: 'sara@example.com', role: 'admin', devices: [key(sara)] }, { email: 'ana@example.com', role: 'member', devices: [key(ana)] }], added: { ...body.added, [key(sara)]: at, [key(ana)]: at } } })
  assert.ok(await roomKeys.advance({ lists: [v2], ws }))
  const own = await keysService.accountLetter(key(anaMac))
  const home = keysService.account()?.workspace.id ?? ''
  const me = await keysService.device()
  const reading = { from: me.publicKey, workspace: home, purpose: 'account-key' as const, body: fromBase64(own.body), allowed: [me.publicKey] }
  assert.deepEqual(await read({ ...reading, recipient: anaMac }), fromBase64(keysService.account()?.key ?? ''))
  assert.equal(await read({ ...reading, recipient: ana }), null)
  await assert.rejects(roomKeys.approve({ ws, email: 'ana@example.com', device: key(ana) }), (err: Error & { status?: number }) => err.status === 409)
  const approved = await roomKeys.approve({ ws, email: 'ana@example.com', device: key(anaMac) })
  assert.deepEqual(bodyOf(approved.list)?.members.find((member) => member.email === 'ana@example.com')?.devices, [key(ana), key(anaMac)])
  assert.ok(await roomKeys.advance({ lists: [approved.list], ws }))
  const anaKey = roomKeys.room(ws)?.workspace.key ?? ''
  const cut = await roomKeys.teamChange({ ws, emails: ['ana@example.com'] })
  assert.deepEqual([bodyOf(cut.list)?.keyVersion ?? 1, cut.letters.length, cut.room.workspace.key], [1, 0, anaKey])
  assert.ok(await roomKeys.advance({ lists: [cut.list], ws }))
  const { list, room, letters } = await roomKeys.teamChange({ ws, rotate: true })
  const after = await check({ anchor: await anchorOf(team.list), chain: [team.list, v2, approved.list, cut.list, list] })
  assert.equal(after?.keyVersion, 2)
  assert.deepEqual(after?.members.map((member) => member.email), ['mo@example.com', 'sara@example.com'])
  assert.ok([key(ana), key(anaMac)].every((device) => after?.removed.includes(device)))
  assert.equal(letters.some((each) => each.to === key(ana) || each.to === key(anaMac)), false)
  const locked = await lock({ key: fromBase64(room.workspace.key), version: 2, bind: `workspace/${ws}/record/after`, plain: new TextEncoder().encode('written after Ana left') })
  assert.ok(locked)
  assert.equal(await unlock({ keys: { 1: fromBase64(anaKey) }, bind: `workspace/${ws}/record/after`, locked }), null)
  const toSara = letters.find((each) => each.to === key(sara))
  assert.ok(toSara)
  const plain = await read({ recipient: sara, from: (await keysService.device()).publicKey, workspace: ws, purpose: 'workspace-key', body: fromBase64(toSara.body), allowed: [(await keysService.device()).publicKey] })
  const secret = plain && JSON.parse(new TextDecoder().decode(plain)) as { key: string; version: number; own?: string }
  assert.equal(secret?.version, 2)
  assert.equal(secret?.own, undefined)
  assert.equal(new TextDecoder().decode(await unlock({ keys: { 2: fromBase64(secret?.key ?? '') }, bind: `workspace/${ws}/record/after`, locked }) ?? new Uint8Array()), 'written after Ana left')
  await roomKeys.setRoom(room)
  await assert.rejects(roomKeys.teamChange({ ws, emails: ['mo@example.com'] }), (err: Error) => err.message === 'Make someone else the owner first.')
  await assert.rejects(roomKeys.withRole({ ws: keysService.account()?.workspace.id ?? '', email: 'mo@example.com', role: 'owner' }))
  const handed = bodyOf(await roomKeys.withRole({ ws, email: 'sara@example.com', role: 'owner' }))
  assert.deepEqual(handed?.members.map((member) => member.role), ['admin', 'owner'])
})

test('the owner prunes old tombstones when it signs, so an honest list never reaches the cap', async () => {
  const me = await keysService.device()
  const team = await roomKeys.createTeam()
  const body = bodyOf(team.list)
  assert.ok(body)
  const removed = Array.from({ length: 1200 }, () => toBase64(newKey(64)))
  const stuffed = await signList({ signer: me, body: { ...body, version: 2, previous: await anchorOf(team.list), removed } })
  await roomKeys.addTeam({ ws: team.workspace.id, list: stuffed, first: team.list })
  const sara = await identity()
  const at = Math.max(Date.now(), body.at ?? 0)
  const v2 = await signList({ signer: me, body: { ...bodyOf(stuffed) ?? body, version: 3, previous: await anchorOf(stuffed), at, members: [...body.members, { email: 'sara@example.com', role: 'member', devices: [toBase64(sara.publicKey)] }], added: { ...body.added, [toBase64(sara.publicKey)]: at } } })
  await roomKeys.addTeam({ ws: team.workspace.id, list: v2, first: team.list })
  const next = bodyOf(await roomKeys.withRole({ ws: team.workspace.id, email: 'sara@example.com', role: 'admin' }))
  assert.equal(next?.removed.length, 500)
  assert.deepEqual(next?.removed, removed.slice(-500))
})

test('a copied Mac sees its keys belong to another machine before anything reads the account or session', async () => {
  await keysService.setSession({ token: 'original-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const before = stored()
  writeFileSync(FILE, seal(JSON.stringify({ ...before, machine: 'another-mac' })), { mode: 0o600 })
  const probe = `const { keysService } = await import(${JSON.stringify(new URL('../../../src/server/cloud/keys-service.ts', import.meta.url).pathname)}); const { toBase64 } = await import('@openhut/common/vault/vault.ts'); const early = { account: keysService.account() ?? null, session: keysService.session() ?? null, kit: keysService.kitState().saved }; console.log(JSON.stringify({ ...early, device: toBase64((await keysService.device()).publicKey) })); process.exit(0)`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: process.env, encoding: 'utf8', cwd: new URL('.', import.meta.url).pathname })
  const after = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { device: string; account: unknown; session: unknown; kit: unknown }
  assert.deepEqual([after.account, after.session, after.kit], [null, null, null])
  assert.notEqual(stored().device, before.device)
})
