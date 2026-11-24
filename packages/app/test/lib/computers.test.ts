import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computersOf, isBrowser, type Computer } from '../../src/lib/computers.ts'

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

test('browsers and the phone app can’t run agents, so they never show as a place to run', () => {
  const list = computersOf({ here, devices: [
    { ...device, key: 'chrome', name: 'Chrome (web)', kind: 'mac', online: false },
    { ...device, key: 'web', name: 'Browser (web)', kind: 'mac' },
    { ...device, key: 'safari', name: 'Mo’s phone', kind: 'mac', os: 'web' },
    { ...device, key: 'box', name: 'hermes-agents', kind: 'server' },
  ] })
  assert.deepEqual(list.map(({ id }) => id), ['local', 'box'])
  assert.equal(isBrowser({ name: 'Chrome (web)' }), true)
  assert.equal(isBrowser({ name: 'web-box', os: 'Linux' }), false)
})

test('outside the desktop shell the computer you’re connected to goes by its own name and kind, not This Mac', () => {
  const remote = { ...here, name: 'Your computer' }
  const devices = [{ ...device, key: 'me', here: true, name: 'hermes-agents', kind: 'server' as const }, { ...device, key: 'chrome', name: 'Chrome (web)', kind: 'mac' as const }]
  const [first, ...rest] = computersOf({ here: remote, devices, shell: false })
  assert.equal(first.name, 'hermes-agents')
  assert.equal(first.server, true)
  assert.equal(first.id, 'local')
  assert.deepEqual(rest, [])
  assert.equal(computersOf({ here, devices, shell: true })[0].name, 'This Mac')
})
