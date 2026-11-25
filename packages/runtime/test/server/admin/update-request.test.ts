import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'openhut-update-'))
process.env.OPENHUT_INSTALL_DIR = dir
const { lastUpdate } = await import('../../../src/server/admin/update-request.ts')

test('no finished update until the installer writes its exit code', () => {
  assert.equal(lastUpdate(), null)
})

test('an update is a request file for whatever swaps the container, not an installer run here', async () => {
  const { request } = await import('../../../src/server/admin/update-request.ts')
  const { readFileSync } = await import('node:fs')
  assert.deepEqual(await request({ appVersion: '0.6.0', sha256: 'a'.repeat(64) }), { updating: true })
  assert.equal(readFileSync(join(dir, 'update.request'), 'utf8'), `${'a'.repeat(64)} 0.6.0\n`)
})

test('a failed install reports the installer\'s last "openhut:" line as the reason', () => {
  writeFileSync(join(dir, 'update.log'), '==> OpenHut\nWaiting for OpenHut......\n==> The new release didn\'t come up. Going back to the previous one\nopenhut: the new release didn\'t come up, so the previous one is running again\n')
  writeFileSync(join(dir, 'update.log.exit'), '1\n')
  const last = lastUpdate()
  assert.equal(last?.exit, 1)
  assert.equal(last?.reason, 'the new release didn\'t come up, so the previous one is running again')
})

test('a successful install has no reason', () => {
  writeFileSync(join(dir, 'update.log'), 'openhut: some note\nOpenHut is running\n')
  writeFileSync(join(dir, 'update.log.exit'), '0\n')
  assert.deepEqual({ ...lastUpdate(), at: undefined }, { exit: 0, at: undefined, reason: null })
  rmSync(dir, { recursive: true, force: true })
})

