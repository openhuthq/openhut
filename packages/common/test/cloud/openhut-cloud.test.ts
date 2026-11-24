import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Computer, Device, Team } from '../../src/cloud/openhut-cloud.ts'
import { TRUST_CALLS } from '../../src/cloud/openhut-cloud.ts'
import { ENDPOINTS, pathOf } from '../../src/cloud/endpoints.ts'
import { KINDS, RULES, SEALED_KINDS, TRUST_KINDS } from '../../src/cloud/rules.ts'

type Trust = (typeof TRUST_CALLS)[number] | keyof Team | 'approve' | 'remove' | 'rotateKeys' | 'records' | 'keyring'
type Leaked = Extract<keyof Device, Trust>
const deviceHasNoTrustCalls: [Leaked] extends [never] ? true : false = true
const computerIsADevice: Computer extends Device ? true : false = true

test('a device client has no trust calls; only a computer can change trust', () => {
  assert.equal(deviceHasNoTrustCalls, true)
  assert.equal(computerIsADevice, true)
  const device = {} as Device
  // @ts-expect-error a device has no team, so no approve, remove, rotateKeys or records
  void device.team
  // @ts-expect-error a device never serves tunnels
  void device.serve
})

test('every endpoint is under /v1 except health, and paths fill their params', () => {
  for (const [name, endpoint] of Object.entries(ENDPOINTS)) assert.ok(endpoint.path.startsWith('/v1/') || name === 'health', name)
  assert.equal(pathOf({ name: 'putRecord', params: { team: 't', kind: 'agent', id: 'a/b' } }), '/v1/teams/t/agent/a%2Fb')
  assert.throws(() => pathOf({ name: 'tunnel' }))
})

test('the rules table has a row for every kind: the trust kinds, each sealed kind, blobs and presence', () => {
  assert.deepEqual(new Set(KINDS), new Set([...TRUST_KINDS, ...SEALED_KINDS, 'blob', 'presence']))
  assert.equal(RULES.presence.stored, false)
  assert.deepEqual(RULES['member-list'].write, ['admin'])
})
