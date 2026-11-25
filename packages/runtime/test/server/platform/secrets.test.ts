import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SECRETS = new URL('../../../src/server/platform/secrets.ts', import.meta.url).pathname
const PROBE = `const { agentToken } = await import(${JSON.stringify(SECRETS)}); const { db } = await import(${JSON.stringify(SECRETS.replace('secrets.ts', 'db.ts'))}); const row = await db.selectFrom('install_setting').select('value').where('name', '=', 'auth_secret').executeTakeFirst(); console.log(JSON.stringify({ token: agentToken({ id: 'ag_x', epoch: 0 }), row: row?.value ?? null })); process.exit(0)`

function boot({ data, env }: { data: string; env: Record<string, string> }): { token: string; row: string | null } {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], { env: { ...process.env, OPENHUT_DATA: data, ...env }, encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').at(-1) ?? '')
}

test('the root secret: from the app when it has a keychain, else kept in the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhut-secret-'))
  const first = boot({ data: join(dir, 'db'), env: {} })
  assert.match(first.row ?? '', /^[0-9a-f]{64}$/)
  assert.equal(boot({ data: join(dir, 'db'), env: {} }).token, first.token)
  const kept = boot({ data: join(dir, 'app'), env: { OPENHUT_SECRET: 'cd'.repeat(32) } })
  assert.equal(kept.row, null)
})
