import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import { connectionRecords, uploadConnections } from '../../../src/server/connections/connection-records.ts'
import { connectionService } from '../../../src/server/connections/connection-service.ts'
import { useFakeRecords } from '../cloud/records-fake.ts'

const actor = { id: 'usr_records1', email: 'owner@example.com', local: true }
await migrate()
await db.insertInto('person').values({ id: actor.id, email: actor.email, role: 'owner' }).execute()
const fake = useFakeRecords()
const account = await keysService.open({ sub: 'dev-records', email: actor.email })
const home = account.workspace.id

test('a connection is one record in the home workspace: name and kind sealed with own, the key with vault; a delete removes it everywhere', async () => {
  const made = await connectionService.create({ actor, kind: 'excalidraw', name: 'Sketches' })
  const row = fake.rows.get(made.id)
  assert.deepEqual([row?.collection, row?.workspace, row?.personal], ['connection', home, true])
  assert.match(JSON.stringify(row?.value), /"kind":"excalidraw","name":"Sketches"/)
  assert.deepEqual((await connectionService.list({ actor })).map((each) => each.name), ['Sketches'])
  await connectionService.delete({ actor, id: made.id })
  assert.equal(fake.rows.get(made.id)?.deleted, true)
  assert.deepEqual(await connectionService.list({ actor }), [])
})

test('a connection added on another computer shows up here, and one it deletes goes', async () => {
  fake.write({ collection: 'connection', id: 'cn_elsewhere', workspace: home, value: { kind: 'postgres', name: 'Orders', account: 'db/orders' }, secret: { dsn: 'postgres://u:p@db/orders' }, personal: true })
  assert.deepEqual((await connectionService.list({ actor })).map((each) => [each.id, each.name]), [['cn_elsewhere', 'Orders']])
  fake.rows.delete('cn_elsewhere')
  assert.deepEqual(await connectionService.list({ actor }), [])
})

test('the upgrade uploads every connection and provider under a computed id: first upload wins, grants follow the new id', async () => {
  await db.insertInto('agent').values({ id: 'ag_upload01', name: 'Juniper', owner_id: actor.id, instructions: '', model: 'claude:sonnet', net: 1, channel_key: 'k', created_at: new Date() }).execute()
  await db.insertInto('connection').values({ id: 'cn_oldlocal', kind: 'postgres', name: 'Orders', account: 'db/orders', owner_id: actor.id, config: seal(JSON.stringify({ dsn: 'postgres://here' })) }).execute()
  await db.insertInto('connection_grant').values({ id: 'gr_upload01', agent_id: 'ag_upload01', connection_id: 'cn_oldlocal' }).execute()
  await settings.setProviderKey('openai', 'sk-uploaded-key')
  const id = connectionRecords.idFor({ kind: 'postgres', name: 'Orders', account: 'db/orders' })
  fake.write({ collection: 'connection', id, workspace: home, value: { kind: 'postgres', name: 'Orders', account: 'db/orders' }, secret: { dsn: 'postgres://first' }, personal: true })

  await uploadConnections()
  assert.match(id, /^cn_[0-9a-f]{16}$/)
  assert.match(JSON.stringify(fake.rows.get(id)?.secret), /postgres:\/\/first/)
  assert.match(JSON.stringify(fake.rows.get(connectionRecords.providerId('openai'))?.secret), /sk-uploaded-key/)
  assert.deepEqual(await db.selectFrom('connection_grant').select('connection_id').execute(), [{ connection_id: id }])
  assert.deepEqual((await db.selectFrom('connection').select('id').execute()).map((row) => row.id), [id])
})
