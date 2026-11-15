import { test } from 'node:test'
import assert from 'node:assert/strict'
import { targetsOf } from '../src/send.ts'

test('targets are flattened from hermes send --list --json, with threads', () => {
  const listed = { platforms: {
    telegram: [{ id: '626583434', name: 'Mo', type: 'dm', thread_id: null }, { id: -1001234567890, name: 'Sales', type: 'group', thread_id: 17585 }],
    slack: [{ id: 'C0123ABCD', name: '#gtm', type: 'channel' }],
  } }
  assert.deepEqual(targetsOf(listed), [
    { id: 'telegram:626583434', platform: 'telegram', name: 'Mo', type: 'dm' },
    { id: 'telegram:-1001234567890:17585', platform: 'telegram', name: 'Sales', type: 'group' },
    { id: 'slack:C0123ABCD', platform: 'slack', name: '#gtm', type: 'channel' },
  ])
})

test('anything that is not a clean target is dropped', () => {
  const listed = { platforms: { slack: ['C0BAD', { id: 'C0 SPACE' }, { id: 'C0OK;rm -rf /' }, { id: 'C0FINE' }], 'Bad Platform': [{ id: 'x' }], whatsapp: 'nope' } }
  assert.deepEqual(targetsOf(listed).map((target) => target.id), ['slack:C0FINE'])
  assert.deepEqual(targetsOf(null), [])
  assert.deepEqual(targetsOf({ platforms: [] }), [])
})
