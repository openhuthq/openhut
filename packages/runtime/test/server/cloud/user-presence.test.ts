import { test } from 'node:test'
import assert from 'node:assert/strict'
import { userPresence } from '../../../src/server/cloud/user-presence.ts'

type Ran = Awaited<ReturnType<typeof userPresence.run>>

function on(platform: NodeJS.Platform, answer: Ran): Array<{ file: string; args: string[]; env?: Record<string, string> }> {
  const calls: Array<{ file: string; args: string[]; env?: Record<string, string> }> = []
  userPresence.shell = () => true
  userPresence.platform = platform
  userPresence.run = async (call) => { calls.push(call); return answer }
  return calls
}

test('Windows: the runtime asks Windows Hello, and approving without it fails', async () => {
  const calls = on('win32', { code: 0, out: 'Canceled' })
  assert.equal(await userPresence.ask('let Chrome into OpenHut'), false)
  assert.equal(calls[0]?.file, 'powershell.exe')
  assert.match(calls[0]?.args.at(-1) ?? '', /UserConsentVerifier\]::RequestVerificationAsync\(\$env:OPENHUT_REASON\)/)
  assert.equal(calls[0]?.env?.OPENHUT_REASON, 'OpenHut wants to let Chrome into OpenHut.', 'the reason goes in through the environment, never into the script')
  for (const out of ['RetriesExhausted', 'DeviceBusy', 'DisabledByPolicy', '']) {
    on('win32', { code: 0, out })
    assert.equal(await userPresence.ask('x'), false, out)
  }
  on('win32', { code: 1, out: 'Verified' })
  assert.equal(await userPresence.ask('x'), false, 'PowerShell failed')
  on('win32', { code: 0, out: 'Verified' })
  assert.equal(await userPresence.ask('x'), true)
  on('win32', { code: 0, out: 'NotConfiguredForUser' })
  assert.equal(await userPresence.ask('x'), true, 'no Windows Hello set up, like a Mac without Touch ID')
})

test('Linux: the runtime asks polkit for the login password, and approving without it fails', async () => {
  const calls = on('linux', { code: 1, out: '' })
  assert.equal(await userPresence.ask('let Chrome into OpenHut'), false)
  assert.deepEqual(calls[0], { file: 'pkcheck', args: ['--action-id', 'org.freedesktop.policykit.exec', '--process', String(process.pid), '--allow-user-interaction'] })
  on('linux', { code: 2, out: '' })
  assert.equal(await userPresence.ask('x'), false, 'not authorized')
  on('linux', { code: 3, out: '' })
  assert.equal(await userPresence.ask('x'), false, 'dismissed')
  on('linux', { code: 0, out: '' })
  assert.equal(await userPresence.ask('x'), true)
  on('linux', { code: 'ENOENT', out: '' })
  assert.equal(await userPresence.ask('x'), true, 'no polkit at all, like a Mac without Touch ID')
})

test('Mac: the runtime asks the shell for Touch ID; outside the app nobody is asked', async () => {
  const calls = on('darwin', { code: 0, out: 'Verified' })
  let touched = ''
  userPresence.touchId = async (reason) => { touched = reason; return false }
  assert.equal(await userPresence.ask('let Chrome into OpenHut'), false)
  assert.equal(touched, 'let Chrome into OpenHut')
  assert.equal(calls.length, 0)
  userPresence.shell = () => false
  assert.equal(await userPresence.ask('x'), true)
})
