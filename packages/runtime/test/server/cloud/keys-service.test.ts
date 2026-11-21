import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, db } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal, unseal } from '../../../src/server/platform/secrets.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import { fromBase64, identity, letter, lock, newKey, newPairing, pairingWorkspace, read, slot, toBase64, unlock } from '@openhut/common/vault/vault.ts'
import { anchorOf, check, signList } from '@openhut/common/cloud/member-list.ts'

await migrate()
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const stored = () => JSON.parse(unseal(readFileSync(FILE, 'utf8'))) as { device: string; machine: string; account: { key: string; workspace: { key: string } } }

test('keys are stored only sealed, in a file only you can read when there is no keychain', async () => {
  assert.equal(keysService.keyStore(), 'file')
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  await keysService.saveKit(kit.box)
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
  await keysService.saveKit(kit.box)
  const mine = { ...await keysService.workspaceBox(account), chain: [account.list] }
  const foreign = { ...mine, id: 'another_ws', key: (await keysService.workspaceBox({ ...account, key: toBase64(newKey()) })).key }
  const saved = { kit: keysService.kitBox() ?? '', workspaces: [foreign, mine] }
  await keysService.setSession(undefined)
  await keysService.forget()
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
  const box = await keysService.workspaceBox(account)
  const workspace = `workspace/${account.workspace.id}`
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: box.key, by: box.by, signature: box.signature } }), true)
  const other = { ...account, key: toBase64(newKey()) }
  const theirs = await keysService.workspaceBox(other)
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: theirs.key, by: theirs.by, signature: theirs.signature } }), false)
  assert.equal(await keysService.boxIsMine({ account, name: workspace, box: { body: theirs.key, by: box.by, signature: box.signature } }), false)
  const savedAt = Date.now()
  const kit = { ...await keysService.signBox({ account, name: 'kit', body: box.key, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal(await keysService.boxIsMine({ account, name: 'kit', box: kit }), true)
  assert.equal(await keysService.boxIsMine({ account, name: 'kit', box: { ...kit, savedAt: new Date(savedAt + 1).toISOString() } }), false)
  assert.equal(await keysService.boxIsMine({ account, name: 'passkey', box: kit }), false)
  assert.equal(await keysService.boxIsMine({ account: other, name: 'kit', box: kit }), false)
})

test('signing in with another Google account is refused, and the first account keeps its keys and kit', async () => {
  const mo = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.saveKit((await keysService.newKit()).box)
  const kit = keysService.kit()
  await assert.rejects(keysService.open({ sub: 'dev-sara', email: 'sara@example.com' }), (err: Error & { status?: number }) => err.status === 409 && /keeps the keys of mo@example\.com\. Sign in with that account, or forget it below\./.test(err.message))
  assert.deepEqual(keysService.account(), mo)
  assert.deepEqual(keysService.kit(), kit)
  const box = keysService.kitBox()
  await keysService.setKit(undefined)
  await assert.rejects(keysService.open({ sub: 'dev-sara', email: 'sara@example.com' }), (err: Error) => /keeps the keys of mo@example\.com\. Sign in with that account and save a recovery kit first\./.test(err.message))
  await keysService.setKit(kit && box ? { box, savedAt: kit.savedAt } : undefined)
})

test('a new Mac reads its pairing letter only with the code it shows, and while younger than 3 days it can’t remove the Mac that let it in', async () => {
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
  const { secret: code } = await newPairing({ device: me, hint: 'mo@example.com' })
  const { secret: otherCode } = await newPairing({ device: me, hint: 'mo@example.com' })
  const sealed = async (sender: typeof oldMac, shown: string) => {
    const context = await pairingWorkspace({ secret: shown, newDevice: me, oldDevice: sender.publicKey, workspace: 'ws_paired01' })
    const body = await letter({ sender, to: me, workspace: context ?? '', purpose: 'pairing', version: 1, plain: accountKey })
    return { id: 'letter01', object: 'letter' as const, to: toBase64(me), from: toBase64(sender.publicKey), workspace: 'ws_paired01', purpose: 'pairing' as const, body: toBase64(body ?? new Uint8Array()) }
  }
  assert.equal(await keysService.readPairing({ secret: otherCode, workspace: 'ws_paired01', found: await sealed(oldMac, code) }), null)
  assert.equal(await keysService.readPairing({ secret: code, workspace: 'ws_paired01', found: await sealed(oldMac, otherCode) }), null)
  assert.equal(await keysService.readPairing({ secret: code, workspace: 'ws_wrong001', found: await sealed(oldMac, code) }), null)
  const opened = await keysService.readPairing({ secret: code, workspace: 'ws_paired01', found: await sealed(oldMac, code) })
  assert.deepEqual(opened, accountKey)
  const account = await keysService.restoreWith({ key: accountKey, workspaces: [{ id: 'ws_paired01', key: box, chain: [genesis] }] })
  assert.ok(account)
  const joined = await check({ anchor: await anchorOf(genesis), chain: [genesis, account.list] })
  assert.deepEqual(joined?.members[0].devices, [...devices, toBase64(me)])
  assert.equal(account.list.by, devices[1])
  await keysService.adopt({ account })
  await assert.rejects(keysService.change([devices[0]]), (err: Error & { status?: number }) => err.status === 403 && /added less than 3 days ago/.test(err.message))
})

test('Not me removes the device in one list version with a new workspace key and account key; the removed Mac gets no letter and can’t read what comes after', async () => {
  await keysService.setSession(undefined)
  await keysService.relock({ sub: 'dev-mo', email: 'mo@example.com' })
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const [stolen, phone] = await Promise.all([identity(), identity()])
  const body = keysService.members()
  assert.ok(body)
  const at = Date.now()
  const mine = body.members[0]
  const added = await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(account.list), at, members: [{ ...mine, devices: [...mine.devices, toBase64(stolen.publicKey), toBase64(phone.publicKey)] }], added: { ...body.added, [toBase64(stolen.publicKey)]: at, [toBase64(phone.publicKey)]: at } } })
  assert.ok(await keysService.advance([added]))
  const oldKey = fromBase64(account.workspace.key)
  const { list, next, letters, handover } = await keysService.change([toBase64(stolen.publicKey)])
  const after = await check({ anchor: await anchorOf(account.list), chain: [account.list, added, list] })
  assert.ok(after)
  assert.equal(after.keyVersion, 2)
  assert.ok(after.removed.includes(toBase64(stolen.publicKey)))
  assert.ok(after.removed.includes(handover.by))
  assert.equal(after.members[0].kit, handover.next)
  assert.notEqual(next.key, account.key)
  assert.deepEqual(next.workspace.old, { 1: account.workspace.key })
  assert.equal(letters.some((each) => each.to === toBase64(stolen.publicKey)), false)
  const locked = await lock({ key: fromBase64(next.workspace.key), version: 2, bind: 'workspace/ws/record/after', plain: new TextEncoder().encode('made after Not me') })
  assert.ok(locked)
  assert.equal(await unlock({ keys: { 1: oldKey, 2: oldKey }, bind: 'workspace/ws/record/after', locked }), null)
  const toPhone = letters.find((each) => each.to === toBase64(phone.publicKey) && each.purpose === 'workspace-key')
  assert.ok(toPhone)
  const plain = await read({ recipient: phone, from: (await keysService.device()).publicKey, workspace: account.workspace.id, purpose: 'workspace-key', body: fromBase64(toPhone.body), allowed: [(await keysService.device()).publicKey] })
  const secret = plain && JSON.parse(new TextDecoder().decode(plain)) as { key: string; version: number }
  assert.equal(secret?.version, 2)
  assert.deepEqual(new TextDecoder().decode(await unlock({ keys: { 2: fromBase64(secret?.key ?? '') }, bind: 'workspace/ws/record/after', locked }) ?? new Uint8Array()), 'made after Not me')
  assert.ok(letters.some((each) => each.to === toBase64(phone.publicKey) && each.purpose === 'account-key'))
})

test('a copied Mac sees its keys belong to another machine before anything reads the account or session', async () => {
  await keysService.setSession({ token: 'original-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const before = stored()
  writeFileSync(FILE, seal(JSON.stringify({ ...before, machine: 'another-mac' })), { mode: 0o600 })
  const probe = `const { keysService } = await import(${JSON.stringify(new URL('../../../src/server/cloud/keys-service.ts', import.meta.url).pathname)}); const { toBase64 } = await import('@openhut/common/vault/vault.ts'); const early = { account: keysService.account() ?? null, session: keysService.session() ?? null, kit: keysService.kit() }; console.log(JSON.stringify({ ...early, device: toBase64((await keysService.device()).publicKey) })); process.exit(0)`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: process.env, encoding: 'utf8', cwd: new URL('.', import.meta.url).pathname })
  const after = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { device: string; account: unknown; session: unknown; kit: unknown }
  assert.deepEqual([after.account, after.session, after.kit], [null, null, null])
  assert.notEqual(stored().device, before.device)
})
