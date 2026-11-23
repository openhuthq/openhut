import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { joinRequests } from '../../../src/features/cloud/seen.ts'

const me = 'mo@example.com'
const ask = (device: string, email: string) => ({ device, email, name: device, at: '2026-11-22T10:00:00Z' })
const home = { id: 'home', name: 'Mo', home: true, own: true, role: 'owner', requests: [ask('new-mac', me)] }
const team = { id: 'team', name: 'Acme', home: false, own: false, role: 'admin', requests: [ask('ana-mac', 'ana@example.com'), ask('my-other-mac', me)] }
const joined = { id: 'joined', name: 'Other', home: false, own: false, role: 'member', requests: [ask('bob-mac', 'bob@example.com')] }
const cloud = (status: string) => ({ status, email: me, workspaces: [home, team, joined] }) as unknown as Cloud

test('your own new computer and a team member’s computer both raise a toast, each opening where you approve it', () => {
  assert.deepEqual(joinRequests({ cloud: cloud('on') }).map(({ request, mine, path }) => [request.device, mine, path]), [
    ['new-mac', true, '/settings/computers'],
    ['ana-mac', false, '/settings/people'],
  ])
})

test('the toast still shows while the cloud is offline, and never on a locked computer', () => {
  assert.equal(joinRequests({ cloud: cloud('offline') }).length, 2)
  assert.deepEqual(joinRequests({ cloud: cloud('locked') }), [])
})
