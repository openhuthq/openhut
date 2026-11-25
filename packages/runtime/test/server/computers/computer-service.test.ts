import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { sha } from '../../../src/server/platform/secrets.ts'
import { admit, computerService } from '../../../src/server/computers/computer-service.ts'

await migrate()
await computerService.boot()
await (await import('../../../src/server/platform/settings.ts')).settings.setAddress('https://agents.example.com')
const actor = { id: 'usr_cmowner1', email: 'owner@example.com', role: 'owner' as const }
const tokenOf = (command: string): string => command.split(' ').at(-1) ?? ''

test('Add a computer gives a 32-byte token kept only as its sha256, good for 10 minutes', async () => {
  const join = await computerService.join({ actor })
  const token = tokenOf(join.command)
  assert.match(join.command, /^curl -fsSL \S+ \| sh -s -- join \S+ ohj_[\w-]{43}$/)
  assert.equal(Buffer.from(token.slice(4), 'base64url').length, 32)
  const row = await db.selectFrom('computer').selectAll().where('id', '=', join.computer.id).executeTakeFirstOrThrow()
  assert.equal(row.token_hash, sha(token))
  assert.equal(JSON.stringify(row).includes(token), false)
  assert.ok(Math.abs(Date.parse(join.expiresAt) - Date.now() - 600_000) < 5_000)
  assert.equal((await computerService.list()).some((computer) => computer.id === join.computer.id), false)
})

test('the token works once to register: the computer gets a new token, and the code is spent', async () => {
  const join = await computerService.join({ actor })
  const code = tokenOf(join.command)
  const first = await admit(code)
  assert.equal(first?.row.id, join.computer.id)
  assert.match(first?.token ?? '', /^ohj_/)
  assert.equal(await admit(code), undefined)
  const again = await admit(first?.token)
  assert.equal(again?.row.id, join.computer.id)
  assert.equal(again?.token, undefined)
  assert.equal((await computerService.list()).some((computer) => computer.id === join.computer.id), true)
})

test('an unused token expires after 10 minutes', async () => {
  const join = await computerService.join({ actor })
  await db.updateTable('computer').set({ expires_at: new Date(Date.now() - 1) }).where('id', '=', join.computer.id).execute()
  assert.equal(await admit(tokenOf(join.command)), undefined)
  assert.equal(await db.selectFrom('computer').select('id').where('id', '=', join.computer.id).executeTakeFirst(), undefined)
})

test('removing a computer revokes its token; this server can\'t be removed', async () => {
  const join = await computerService.join({ actor })
  const token = (await admit(tokenOf(join.command)))?.token
  const removed = await computerService.remove({ actor, id: join.computer.id })
  assert.match(removed.uninstall, /docker rm -f openhut-runtime/)
  assert.equal(await admit(token), undefined)
  await assert.rejects(computerService.remove({ actor, id: 'here' }), { status: 409 })
})
