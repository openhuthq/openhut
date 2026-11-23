import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computersOf, type Computer } from '../../src/lib/computers.ts'

const here: Computer = { id: 'local', name: 'This Mac', kind: 'here', url: '', online: true, features: { whatsapp: false, browser: false }, appTooOld: false, runtimeTooOld: false }
const device = { here: false, addedAt: null, online: true }

test('this computer alone is the only place to run', () => {
  assert.deepEqual(computersOf({ here, devices: [] }), [here])
  assert.deepEqual(computersOf({ here, devices: [{ ...device, key: 'me', here: true, name: 'Mo’s MacBook', kind: 'mac' }] }), [here])
})

test('your other Macs and PCs and your servers come after this computer, offline ones too', () => {
  const list = computersOf({ here, devices: [
    { ...device, key: 'me', here: true, name: 'Mo’s MacBook', kind: 'mac' },
    { ...device, key: 'studio', name: 'Mac Studio', kind: 'mac' },
    { ...device, key: 'box', name: null, kind: 'server', online: false },
    { ...device, key: 'pc', name: null, kind: 'mac' },
  ] })
  assert.deepEqual(list.map(({ id, name, kind, online }) => ({ id, name, kind, online })), [
    { id: 'local', name: 'This Mac', kind: 'here', online: true },
    { id: 'studio', name: 'Mac Studio', kind: 'desktop', online: true },
    { id: 'box', name: 'Server', kind: 'server', online: false },
    { id: 'pc', name: 'Your other computer', kind: 'desktop', online: true },
  ])
  assert.deepEqual(list[2].features, { whatsapp: true, browser: true })
  assert.deepEqual(list[1].features, { whatsapp: false, browser: false })
})
