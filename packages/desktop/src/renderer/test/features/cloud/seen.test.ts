import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { goneNotice, newDevices } from '../../../src/features/cloud/seen.ts'

const device = (key: string, addedAt: string | null, here = false) => ({ key, here, addedAt, name: key, kind: 'mac', online: true, os: null, heard: true, joined: null }) as Cloud['devices'][number]

test('a newly approved computer never announces a computer that was on the account before it, even when it knew of none yet', () => {
  const old = device('main-mac', '2026-11-24T08:00:00Z')
  const me = device('new-laptop', '2026-11-24T09:00:00Z', true)
  assert.deepEqual(newDevices({ devices: [old, me], known: new Set(['new-laptop']) }), [])
  assert.deepEqual(newDevices({ devices: [old, me], known: new Set() }), [])
})

test('a computer added after this one is announced while it isn’t known yet', () => {
  const me = device('main-mac', '2026-11-24T08:00:00Z', true)
  const later = device('stolen-kit', '2026-11-24T10:00:00Z')
  assert.deepEqual(newDevices({ devices: [me, later], known: new Set(['main-mac']) }).map((each) => each.key), ['stolen-kit'])
  assert.deepEqual(newDevices({ devices: [me, later], known: new Set(['main-mac', 'stolen-kit']) }), [])
})

test('nothing is announced before this computer sees itself on the list, or before anything is known', () => {
  const later = device('other', '2026-11-24T10:00:00Z')
  assert.deepEqual(newDevices({ devices: [later], known: new Set() }), [])
  assert.deepEqual(newDevices({ devices: [device('me', '2026-11-24T08:00:00Z', true), later], known: null }), [])
})

test('a teammate whose computer the owner removed is told who did it and from which team', () => {
  assert.deepEqual(goneNotice({ name: 'Mo’s team', why: 'removed', owner: 'mo@example.com' }), { title: 'Mo removed this computer from Mo’s team', note: 'Ask Mo to invite you again if that’s a mistake.' })
  assert.equal(goneNotice({ name: 'Acme', why: 'deleted', owner: 'mo@example.com' }).title, 'Acme was deleted')
  assert.equal(goneNotice({ name: 'Acme', why: 'removed', owner: null }).title, 'You were removed from Acme')
})
