import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { UPDATE_KEY, downloadUrl, followUpdate, progressTitle, readyNote, updateNote, type UpdateBridge, type UpdateState } from '../../../src/features/settings/update.ts'

const idle: UpdateState = { current: '0.1.1', checking: false, available: null, ready: null, error: null }

function mockBridge(start: UpdateState) {
  const listeners: ((state: UpdateState) => void)[] = []
  const bridge: UpdateBridge = {
    state: async () => start,
    check: async () => start,
    install: async () => ({ installing: true }),
    onChange: (listener) => { listeners.push(listener) },
  }
  return { bridge, fire: (next: UpdateState) => listeners.forEach((listener) => listener(next)) }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('the app follows the main process from download to ready', async () => {
  const client = new QueryClient()
  const { bridge, fire } = mockBridge(idle)
  followUpdate({ bridge, client })
  await settle()
  const before = client.getQueryData<UpdateState>(UPDATE_KEY)
  assert.deepEqual(before, idle)
  assert.equal(readyNote(before), undefined)
  fire({ ...idle, available: '0.1.2' })
  assert.equal(updateNote(client.getQueryData<UpdateState>(UPDATE_KEY)!), 'Downloading OpenHut 0.1.2…')
  fire({ ...idle, available: '0.1.2', ready: { version: '0.1.2' } })
  assert.equal(readyNote(client.getQueryData<UpdateState>(UPDATE_KEY)), 'OpenHut 0.1.2 is ready')
})

test('a refused or failed update says so instead of up to date', () => {
  assert.match(updateNote({ ...idle, error: 'signature' }), /isn't signed by OpenHut/)
  assert.match(updateNote({ ...idle, error: 'failed' }), /Couldn't update/)
  assert.equal(updateNote(idle), 'Updates download on their own.')
})

test('a window opened after the download still sees the update', async () => {
  const client = new QueryClient()
  followUpdate({ bridge: mockBridge({ ...idle, ready: { version: '0.1.2' } }).bridge, client })
  await settle()
  assert.equal(readyNote(client.getQueryData<UpdateState>(UPDATE_KEY)), 'OpenHut 0.1.2 is ready')
})

test('without the desktop bridge there is no update state', () => {
  const client = new QueryClient()
  followUpdate({ bridge: undefined, client })
  assert.equal(client.getQueryData(UPDATE_KEY), undefined)
  assert.equal(readyNote(null), undefined)
})

test('the download link matches the platform', () => {
  assert.equal(downloadUrl('darwin'), 'https://openhut.dev/download/mac')
  assert.equal(downloadUrl('linux'), 'https://openhut.dev/download/linux')
})

test('the update card names how far the download is in plain words', () => {
  assert.equal(progressTitle(undefined), 'Packing a few things')
  assert.equal(progressTitle(50), 'Fixing up the hut')
  assert.equal(progressTitle(95), 'Nearly there')
})
