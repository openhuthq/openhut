import { test } from 'node:test'
import assert from 'node:assert/strict'
import { devBuild, devCloud, devLabel } from '../src/dev-build.mjs'

test('only a packaged release named OpenHut, without a test home, is the real app', () => {
  assert.equal(devBuild({ packaged: true, name: 'OpenHut', testHome: undefined }), false)
  assert.equal(devBuild({ packaged: false, name: 'OpenHut', testHome: undefined }), true)
  assert.equal(devBuild({ packaged: true, name: 'OpenHut Dev', testHome: undefined }), true)
  assert.equal(devBuild({ packaged: true, name: 'OpenHut', testHome: '/tmp/home' }), true)
})

test('a dev run reaches the local cloud unless told otherwise, and says which', () => {
  assert.deepEqual(devCloud({}), { OPENHUT_CLOUD_URL: 'http://127.0.0.1:8790', OPENHUT_API_URL: 'http://127.0.0.1:8792' })
  assert.equal(devCloud({ OPENHUT_CLOUD_URL: 'https://cloud.openhut.dev' }).OPENHUT_CLOUD_URL, 'https://cloud.openhut.dev')
  assert.equal(devLabel('http://127.0.0.1:8790'), 'Dev · local cloud')
  assert.equal(devLabel('https://cloud.openhut.dev'), 'Dev · cloud.openhut.dev')
})
