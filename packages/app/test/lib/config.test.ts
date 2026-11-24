import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOUD, loadConfig } from '../../src/lib/config.ts'

test('the App reads its Cloud from /config.json, and without one it is the web App on cloud.openhut.dev', async () => {
  assert.deepEqual(await loadConfig(async () => ({ cloud: 'http://127.0.0.1:8000/api', local: true })), { cloud: 'http://127.0.0.1:8000/api', local: true })
  assert.deepEqual(await loadConfig(async () => { throw new Error('404') }), { cloud: CLOUD })
  assert.deepEqual(await loadConfig(async () => ({ cloud: 42 })), { cloud: CLOUD })
})
