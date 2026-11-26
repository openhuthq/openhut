import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeKey, placeName, samePlace, sourceOf, startedIn, firstThreads, type SourcedThread } from '../../../src/features/threads/places.ts'

const thread = (origin?: SourcedThread['origin']): SourcedThread => ({ id: 'th_1', object: 'thread', agentId: 'ag_1', title: 'Disk full', createdAt: '2026-11-26T10:00:00Z', updatedAt: '2026-11-26T10:00:00Z', origin, mirrors: [] })

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

test('the sidebar shows every waiting thread, then the newest up to three', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...thread(), id, waiting: id === 'd' }))
  assert.deepEqual(firstThreads(list).map((each) => each.id), ['d', 'a', 'b'])
  const busy = list.map((each) => ({ ...each, waiting: each.id !== 'a' }))
  assert.deepEqual(firstThreads(busy).map((each) => each.id), ['b', 'c', 'd', 'e'])
})
