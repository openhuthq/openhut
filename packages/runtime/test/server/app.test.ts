import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

test('in local mode the server listens on a socket only its own user can open, and stamps its build on every answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-sock-'))
  const socket = join(dir, 'app.sock')
  const child = spawn(process.execPath, ['--no-node-snapshot', new URL('../../src/server/app.ts', import.meta.url).pathname], { env: { ...process.env, OPENHUT_DATA: dir, OPENHUT_SOCKET: socket }, stdio: 'ignore' })
  try {
    const answered = (path = '/health') => new Promise<string | false>((done) => get({ socketPath: socket, path }, (res) => done(res.resume() && String(res.headers['x-openhut-build']))).on('error', () => done(false)))
    for (let i = 0; i < 150 && !(await answered()); i++) await sleep(100)
    assert.equal(statSync(socket).mode & 0o777, 0o600)
    const build = await answered()
    assert.ok(build && build !== 'undefined')
    assert.equal(await answered('/api/nothing-here'), build)
  } finally {
    child.kill('SIGKILL')
  }
})
