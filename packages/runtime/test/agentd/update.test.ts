import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'openhut-update-'))
process.env.OPENHUT_UPDATE_LOG = join(dir, 'update.log')
const { lastUpdate } = await import('../../src/agentd/update.ts')

test('no finished update until the installer writes its exit code', () => {
  assert.equal(lastUpdate(), null)
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

test('the update runs only the installer it was asked for, and records why it stopped', async () => {
  const { execFileSync } = await import('node:child_process')
  const { createHash } = await import('node:crypto')
  const { readFileSync } = await import('node:fs')
  const { UPDATE_SCRIPT } = await import('../../src/agentd/update.ts')
  const work = mkdtempSync(join(tmpdir(), 'openhut-update-run-'))
  const installer = join(work, 'install.sh')
  writeFileSync(installer, 'echo "installing $OPENHUT_APP_VERSION"\nexit 0\n')
  const sha = createHash('sha256').update(readFileSync(installer)).digest('hex')
  const run = (sha256: string) => {
    execFileSync('/bin/sh', ['-c', UPDATE_SCRIPT], { env: { ...process.env, OPENHUT_URL: `file://${installer}`, OPENHUT_SHA256: sha256, OPENHUT_APP_VERSION: '0.2.0', LOG: join(work, 'log'), EXIT: join(work, 'exit') } })
    return { exit: readFileSync(join(work, 'exit'), 'utf8').trim(), log: readFileSync(join(work, 'log'), 'utf8') }
  }
  assert.deepEqual(run(sha), { exit: '0', log: 'installing 0.2.0\n' })
  const changed = run('0'.repeat(64))
  assert.equal(changed.exit, '3')
  assert.match(changed.log, /a newer release came out/)
  rmSync(work, { recursive: true, force: true })
})
