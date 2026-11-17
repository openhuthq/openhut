import { test } from 'node:test'
import assert from 'node:assert/strict'
import { userInfo } from 'node:os'
import type { FastifyRequest } from 'fastify'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { callerOf, who } from '../../../src/server/team/identity.ts'

await migrate()
const sending = (authorization?: string) => ({ headers: { authorization } }) as unknown as FastifyRequest

test('a remote runtime answers only the key the app enrolled, as the one owner', async () => {
  await assert.rejects(who(sending()), { status: 401 })
  await assert.rejects(who(sending('Bearer wrong-key')), { status: 401 })
  await assert.rejects(who(sending('test-key')), { status: 401 })
  assert.equal((await who(sending('Bearer test-key'))).email, userInfo().username)
  assert.deepEqual(await callerOf(sending('Bearer test-key')), await callerOf(sending('Bearer test-key')))
})

test('local mode: every request on the socket is the owner, with or without a key', async (t) => {
  config.socket = '/tmp/openhut-test.sock'
  t.after(() => { config.socket = undefined })
  assert.deepEqual(await callerOf(sending()), await callerOf(sending('Bearer wrong-key')))
  assert.equal((await callerOf(sending()))?.email, userInfo().username)
})
