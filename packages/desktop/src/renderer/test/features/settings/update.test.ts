import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { UPDATE_KEY, followUpdate, readyNote, type Ready, type UpdateBridge, type UpdateState } from '../../../src/features/settings/update.ts'

function mockBridge(ready: Ready | null) {
  const listeners: ((ready: Ready) => void)[] = []
  const bridge: UpdateBridge = {
    state: async () => ({ current: '0.1.1', ready }),
    install: async () => ({ installing: true }),
    onReady: (listener) => { listeners.push(listener) },
  }
  return { bridge, fire: (next: Ready) => listeners.forEach((listener) => listener(next)) }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('the app shows nothing until an update is downloaded, then says which version is ready', async () => {
  const client = new QueryClient()
  const { bridge, fire } = mockBridge(null)
  followUpdate({ bridge, client })
  await settle()
  const before = client.getQueryData<UpdateState>(UPDATE_KEY)
  assert.deepEqual(before, { current: '0.1.1', ready: null })
  assert.equal(readyNote(before), undefined)
  fire({ version: '0.1.2' })
  assert.equal(readyNote(client.getQueryData<UpdateState>(UPDATE_KEY)), 'OpenHut 0.1.2 is ready')
})

test('a window opened after the download still sees the update', async () => {
  const client = new QueryClient()
  followUpdate({ bridge: mockBridge({ version: '0.1.2' }).bridge, client })
  await settle()
  assert.equal(readyNote(client.getQueryData<UpdateState>(UPDATE_KEY)), 'OpenHut 0.1.2 is ready')
})

test('without the desktop bridge there is no update state', () => {
  const client = new QueryClient()
  followUpdate({ bridge: undefined, client })
  assert.equal(client.getQueryData(UPDATE_KEY), undefined)
  assert.equal(readyNote(null), undefined)
})
