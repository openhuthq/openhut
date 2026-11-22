import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { freshDevice, markSeen, seenDevices } from '../../../src/features/cloud/seen.ts'

const now = Date.parse('2026-11-22T10:00:00Z')
const device = (key: string, minutesAgo: number, here = false) => ({ key, here, addedAt: new Date(now - minutesAgo * 60_000).toISOString(), name: key, kind: 'mac' as const })
const cloud = { devices: [device('this-mac', 60, true), device('added-from-phone', 1), device('someone-else', 1)] } as Cloud

test('a successful Add a Mac clears the mounted alert for that Mac, and another new Mac still alerts', () => {
  let shown = freshDevice({ cloud, seen: seenDevices.get(), now })?.key
  const stop = seenDevices.subscribe(() => { shown = freshDevice({ cloud, seen: seenDevices.get(), now })?.key })
  assert.equal(shown, 'added-from-phone')
  markSeen(['added-from-phone'])
  assert.equal(shown, 'someone-else')
  markSeen(['someone-else'])
  assert.equal(shown, undefined)
  stop()
})

test('Macs added before this one or more than three days ago never alert', () => {
  const old = { devices: [device('this-mac', 60, true), device('before', 120), device('long-ago', 4 * 24 * 60)] } as Cloud
  assert.equal(freshDevice({ cloud: old, seen: [], now }), undefined)
})
