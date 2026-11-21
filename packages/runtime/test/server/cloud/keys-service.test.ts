import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, db } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal, unseal } from '../../../src/server/platform/secrets.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/vault.ts'
import { anchorOf, check } from '@openhut/common/cloud/member-list.ts'

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

test('the 12 words rebuild the account key, and a used kit is retired for a new one', async () => {
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  await keysService.saveKit(kit.box)
  const typo = [...kit.words]
  typo[3] = typo[3] === 'abandon' ? 'ability' : 'abandon'
  assert.equal(await keysService.fromKit(typo), null)
  const used = await keysService.fromKit(kit.words)
  assert.equal(toBase64(used?.key ?? new Uint8Array()), stored().account.key)
  assert.equal(await keysService.fromKit(kit.words), null)
  const again = await keysService.fromKit(used?.kit.words ?? [])
  assert.equal(toBase64(again?.key ?? new Uint8Array()), stored().account.key)
})

test('a signed-out Mac unlocks with the 12 words: the kit box opens the account key, the workspace box its key, and the account key signs this Mac in', async () => {
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  await keysService.saveKit(kit.box)
  const saved = { kit: keysService.kitBox() ?? '', workspace: await keysService.workspaceBox(account), chain: [account.list] }
  await keysService.setLocked({ sub: 'dev-mo', email: 'mo@example.com' })
  const typo = [...kit.words].reverse()
  assert.equal(await keysService.restore({ words: typo, ...saved }), null)
  assert.equal(await keysService.restore({ words: kit.words, ...saved, workspace: { ...saved.workspace, id: 'another_ws' } }), null)
  const restored = await keysService.restore({ words: kit.words, ...saved })
  assert.equal(restored?.key, account.key)
  assert.equal(restored?.workspace.key, account.workspace.key)
  const body = await check({ anchor: await anchorOf(account.list), chain: [account.list, restored?.list ?? account.list] })
  assert.equal(body?.version, 2)
  assert.ok(body?.members[0].devices.includes(toBase64((await keysService.device()).publicKey)))
})

test('signing in with another Google account is refused, and the first account keeps its keys and kit', async () => {
  const mo = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = keysService.kit()
  await assert.rejects(keysService.open({ sub: 'dev-sara', email: 'sara@example.com' }), (err: Error & { status?: number }) => err.status === 409 && /signed in to mo@example\.com\. Sign in with that account\./.test(err.message))
  assert.deepEqual(keysService.account(), mo)
  assert.deepEqual(keysService.kit(), kit)
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
