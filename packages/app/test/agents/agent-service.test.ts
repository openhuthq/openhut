import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../src/platform/db.ts'
import { agentToken, seal } from '../../src/platform/secrets.ts'
import { agentService } from '../../src/agents/agent-service.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_tokenown', email: 'tokenowner@example.com', pass: 'x', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_tokentst', name: 'Dev', owner_id: 'usr_tokenown', instructions: '# Dev', model: 'sonnet', net: 7, channel_key: seal('k'.repeat(32)) }).execute()
const token = agentToken('ag_tokentst')

test('an agent token works only from that agent\'s own network', async () => {
  assert.equal((await agentService.byToken({ token, address: '10.200.7.2' }))?.id, 'ag_tokentst')
  assert.equal(await agentService.byToken({ token, address: '10.200.8.2' }), undefined)
})

test('a forged token is refused', async () => {
  const forged = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
  assert.equal(await agentService.byToken({ token: forged, address: '10.200.7.2' }), undefined)
})
