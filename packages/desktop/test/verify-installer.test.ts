import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MIN_AGE_SECONDS } from '../src/release-key.mjs'
import { verifyInstaller } from '../../../install/verify-installer.mjs'
import { fakeRekor } from './fake-rekor.ts'

const root = join(import.meta.dirname, '../../..')

test('R7: the server updater runs only an install.sh named by a signed release, logged an hour ago (SEC6)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-installer-'))
  const keyFile = join(dir, 'test-release.pem')
  const key = (await promisify(execFile)('node', [join(root, 'scripts/release-key.ts'), 'key', keyFile])).stdout.trim()
  const integratedTime = 1_800_000_000
  const { rekorKey, server } = fakeRekor(() => integratedTime)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    writeFileSync(join(dir, 'install.sh'), '#!/bin/sh\necho the real installer\n')
    writeFileSync(join(dir, 'openhut.tgz'), 'the server runtime')
    await promisify(execFile)('node', [join(root, 'scripts/release-key.ts'), 'sign', keyFile, dir, '9.9.9', '--rekor', `http://127.0.0.1:${(server.address() as any).port}`])
    const read = (name: string) => readFileSync(join(dir, name), 'utf8')
    const release = { manifest: read('release.json'), signature: read('release.json.sig'), rekor: JSON.parse(read('release.json.rekor')), key, rekorKey }
    const hourOld = (integratedTime + MIN_AGE_SECONDS) * 1000
    assert.deepEqual(verifyInstaller({ ...release, installer: read('install.sh'), now: hourOld }), { ok: true })
    assert.match(verifyInstaller({ ...release, installer: read('install.sh'), now: hourOld - 1 }).reason, /less than an hour ago/, 'Update now waits for the age rule')
    assert.match(verifyInstaller({ ...release, installer: '#!/bin/sh\necho a swapped installer\n', now: hourOld }).reason, /isn't the one the signed release names/)
    assert.match(verifyInstaller({ ...release, installer: read('install.sh'), rekor: undefined, now: hourOld }).reason, /no Rekor entry/, 'Rekor missing: nothing installs')
    assert.equal(verifyInstaller({ ...release, installer: read('install.sh'), now: hourOld, key: undefined }).ok, false, 'the pinned key refuses a test-key release')
  } finally {
    server.close()
  }
})
