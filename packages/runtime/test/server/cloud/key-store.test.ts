import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, db } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal, unseal } from '../../../src/server/platform/secrets.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import { keyring } from '@openhut/common/keyring/keyring.ts'
import { keyStore } from '../../../src/server/cloud/key-store.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/public.ts'

await migrate()
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const stored = () => JSON.parse(unseal(readFileSync(FILE, 'utf8'))) as { device: string; machine: string; account: { key: string; workspace: { key: string } } }

test('keys are stored only sealed, in a file only you can read when there is no keychain', async () => {
  assert.equal(keyStore.kind(), 'file')
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const kit = await keyring.kit()
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

test('a copied Mac sees its keys belong to another machine before anything reads the account or session', async () => {
  await keysService.setSession({ token: 'original-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const before = stored()
  writeFileSync(FILE, seal(JSON.stringify({ ...before, machine: 'another-mac' })), { mode: 0o600 })
  const probe = `const { keysService } = await import(${JSON.stringify(new URL('../../../src/server/cloud/keys-service.ts', import.meta.url).pathname)}); const { toBase64 } = await import('@openhut/common/vault/public.ts'); const early = { account: keysService.account() ?? null, session: keysService.session() ?? null, kit: keysService.kitState().saved }; console.log(JSON.stringify({ ...early, device: await keysService.deviceKey() })); process.exit(0)`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: process.env, encoding: 'utf8', cwd: new URL('.', import.meta.url).pathname })
  const after = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { device: string; account: unknown; session: unknown; kit: unknown }
  assert.deepEqual([after.account, after.session, after.kit], [null, null, null])
  assert.notEqual(stored().device, before.device)
})
