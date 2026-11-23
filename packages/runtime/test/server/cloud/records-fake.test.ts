import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordsService, type Change } from '../../../src/server/cloud/records.ts'
import { useFakeRecords } from './records-fake.ts'

const fake = useFakeRecords()

test('the fake records keep a put, reapply on a 409, queue runner writes while offline and tell listeners', async () => {
  const heard: Change[] = []
  const stop = recordsService.onChange((change) => heard.push(change))
  const first = await recordsService.put({ collection: 'agent', id: 'ag_fake0001', workspace: 'ws_home', value: { name: 'Juniper' } })
  assert.equal(first?.ver, 1)
  fake.write({ collection: 'agent', id: 'ag_fake0001', workspace: 'ws_home', value: { name: 'Juno' } })
  const merged = await recordsService.put({ collection: 'agent', id: 'ag_fake0001', workspace: 'ws_home', value: { name: 'Mine' }, reapply: (current) => ({ value: { ...current.value as object, edited: true } }) })
  assert.deepEqual([merged?.ver, merged?.value], [3, { name: 'Juno', edited: true }])
  await fake.offline(true)
  await assert.rejects(recordsService.put({ collection: 'agent', id: 'ag_fake0001', workspace: 'ws_home', value: {} }), (err: Error & { status?: number }) => err.status === 502)
  assert.equal(await recordsService.put({ collection: 'message', id: 'msg_fake0001', workspace: 'ws_home', parent: 'ag_fake0001', value: { text: 'hi' }, queue: true }), null)
  await fake.offline(false)
  assert.deepEqual((await recordsService.list({ collection: 'message', workspace: 'ws_home', parent: 'ag_fake0001' })).map((each) => each.value), [{ text: 'hi' }])
  await recordsService.remove({ collection: 'agent', id: 'ag_fake0001' })
  assert.equal((await recordsService.get({ collection: 'agent', id: 'ag_fake0001' }))?.deleted, true)
  assert.equal(await recordsService.held('ag_fake0001'), 4)
  assert.deepEqual(heard.map((each) => `${each.collection}:${each.ver}`), ['agent:1', 'agent:2', 'agent:3', 'message:1', 'agent:4'])
  stop()
})
