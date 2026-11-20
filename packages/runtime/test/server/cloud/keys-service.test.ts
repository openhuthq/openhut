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

await migrate()
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const stored = () => JSON.parse(unseal(readFileSync(FILE, 'utf8'))) as { device: string; machine: string; account: { key: string; workspace: { key: string } } }

test('keys are stored only sealed, in a file only you can read when there is no keychain', async () => {
  assert.equal(keysService.keyStore(), 'file')
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  assert.equal(await keysService.confirmKit(kit.ask.map((index) => kit.words[index])), true)
  const raw = readFileSync(FILE, 'utf8')
  assert.equal(statSync(FILE).mode & 0o777, 0o600)
  const { device, account } = stored()
  const rows = JSON.stringify(await db.selectFrom('install_setting').selectAll().execute())
  for (const secret of [device, account.key, account.workspace.key, Buffer.from(fromBase64(account.key)).toString('hex'), ...kit.words]) {
    assert.equal(raw.includes(secret), false)
    assert.equal(rows.includes(secret), false)
  }
})

test('the 12 words rebuild the account key, and a used kit is retired for a new one', async () => {
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keysService.newKit()
  assert.equal(await keysService.confirmKit(['wrong', 'words']), false)
  assert.equal(await keysService.confirmKit(kit.ask.map((index) => kit.words[index])), true)
  const typo = [...kit.words]
  typo[3] = typo[3] === 'abandon' ? 'ability' : 'abandon'
  assert.equal(await keysService.fromKit(typo), null)
  const used = await keysService.fromKit(kit.words)
  assert.equal(toBase64(used?.key ?? new Uint8Array()), stored().account.key)
  assert.equal(await keysService.fromKit(kit.words), null)
  const again = await keysService.fromKit(used?.kit.words ?? [])
  assert.equal(toBase64(again?.key ?? new Uint8Array()), stored().account.key)
})

test('a copied Mac sees its device key belongs to another machine and makes a new one', async () => {
  const before = stored()
  writeFileSync(FILE, seal(JSON.stringify({ ...before, machine: 'another-mac' })), { mode: 0o600 })
  const probe = `const { keysService } = await import(${JSON.stringify(new URL('../../../src/server/cloud/keys-service.ts', import.meta.url).pathname)}); const { toBase64 } = await import('@openhut/common/vault/vault.ts'); console.log(JSON.stringify({ device: toBase64((await keysService.device()).publicKey), account: keysService.account() ?? null })); process.exit(0)`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: process.env, encoding: 'utf8', cwd: new URL('.', import.meta.url).pathname })
  const after = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { device: string; account: unknown }
  assert.equal(after.account, null)
  assert.notEqual(stored().device, before.device)
})
