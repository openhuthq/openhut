import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeKey, placeName, samePlace, sourceOf, startedIn, threadsOf, type SourcedThread } from '../../src/lib/places.ts'

const thread = (origin?: SourcedThread['origin']): SourcedThread => ({ id: 'th_1', object: 'thread', agentId: 'ag_1', title: 'Disk full', preview: '', createdAt: '2026-11-26T10:00:00Z', updatedAt: '2026-11-26T10:00:00Z', origin, mirrors: [] })

test('every thread says where it came from, in the words people know', () => {
  assert.deepEqual(sourceOf(thread({ platform: 'discord', label: 'agents-humans', url: 'https://discord.com/x' })), { platform: 'discord', word: 'Discord', label: '#agents-humans' })
  assert.deepEqual(sourceOf(thread({ platform: 'webhook', label: 'DigitalOcean Postgres alerts' })), { platform: 'webhook', word: 'Webhook', label: 'DigitalOcean Postgres alerts' })
  assert.deepEqual(sourceOf(thread({ platform: 'routine', label: '' })), { platform: 'routine', word: 'Routine', label: 'Routine' })
  assert.deepEqual(sourceOf(thread({ platform: 'app', label: 'anything' })), { platform: 'app', word: 'Web', label: 'Web' })
  assert.equal(sourceOf(thread()).label, 'Web')
  assert.equal(startedIn(thread({ platform: 'discord', label: '#agents-humans' })), 'Discord #agents-humans')
})

test('a place is named with a # in chat apps and matched by chat and thread', () => {
  const room = { platform: 'discord', chat_id: '1180', chat_name: 'on-call' }
  assert.equal(placeName(room), '#on-call')
  assert.equal(placeName({ platform: 'telegram', chat_id: '5', chat_name: 'Ops group' }), 'Ops group')
  assert.ok(samePlace(room, { ...room, chat_name: 'renamed' }))
  assert.ok(!samePlace(room, { ...room, thread_id: '9' }))
  assert.ok(!samePlace(room, null))
  assert.equal(placeKey({ ...room, thread_id: '9' }), 'discord:1180:9')
})

test('the thread list starts with the main thread, then the newest', () => {
  const at = (id: string, agentId: string, minutes: number) => ({ ...thread(), id, agentId, updatedAt: new Date(Date.UTC(2026, 10, 26, 10, minutes)).toISOString() })
  const list = [at('th_old', 'ag_1', 1), at('ag_1', 'ag_1', 0), at('th_other', 'ag_2', 9), at('th_new', 'ag_1', 5)]
  const agent = { id: 'ag_1', createdAt: '2026-11-20T10:00:00Z' }
  assert.deepEqual(threadsOf({ threads: list, agent }).map((each) => each.id), ['ag_1', 'th_new', 'th_old'])
  const listed = threadsOf({ threads: list.filter((each) => each.id !== 'ag_1'), agent })
  assert.deepEqual(listed.map((each) => each.id), ['ag_1', 'th_new', 'th_old'], 'the main thread is pinned first even before it has a message')
  assert.equal(listed[0]?.updatedAt, agent.createdAt)
})
