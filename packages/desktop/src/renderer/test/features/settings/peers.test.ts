import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byEligibility, stateOf, type Peer } from '../../../src/features/settings/peers.ts'

const peer = (name: string, change: Partial<Peer>): Peer => ({ name, dns: `${name}.tail.ts.net`, os: 'linux', ip: '', online: true, ssh: true, ...change })

test('only online Linux computers with Tailscale SSH on can run agents, and they sort first', () => {
  const peers = [peer('phone', { os: 'iOS' }), peer('nuc', { online: false }), peer('mac', { os: 'macOS' }), peer('vps', { ssh: false }), peer('beelink', {})]
  assert.deepEqual(peers.map(stateOf), ['phone', 'offline', 'not-linux', 'ssh-off', 'ready'])
  assert.deepEqual(byEligibility(peers).map((each) => each.name), ['beelink', 'vps', 'mac', 'nuc', 'phone'])
})
