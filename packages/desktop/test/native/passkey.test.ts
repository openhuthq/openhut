import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'

const folder = join(import.meta.dirname, '..', '..', 'native', 'passkey')
const swift = process.platform === 'darwin' && spawnSync('swiftc', ['--version']).status === 0

test('the passkey helper answers in JSON, says an unsigned build can’t use passkeys, and fails cleanly without the associated domain', { skip: !swift && 'needs macOS with swiftc' }, () => {
  const app = execFileSync(join(folder, 'build.sh'), { encoding: 'utf8' }).trim().split('\n').at(-1) ?? ''
  const helper = join(app, 'Contents', 'MacOS', 'passkey')
  const run = (args: string[]) => {
    const done = spawnSync(helper, args, { encoding: 'utf8', timeout: 15_000 })
    return { status: done.status, json: JSON.parse(done.stdout) as Record<string, unknown> }
  }
  const status = run(['status'])
  assert.equal(status.status, 0)
  assert.equal(status.json.rp, 'keys.openhut.dev')
  assert.equal(status.json.passkeys, false)
  assert.equal(typeof status.json.prf, 'boolean')
  assert.deepEqual(run(['create']), { status: 64, json: { error: 'usage', message: 'passkey status | create <email> | open' } })
  assert.equal(run(['delete', 'x']).status, 64)
  const open = run(['open'])
  assert.equal(open.status, status.json.prf ? 1 : 2)
  assert.equal(open.json.error, status.json.prf ? 'failed' : 'needs-macos-15')
})
