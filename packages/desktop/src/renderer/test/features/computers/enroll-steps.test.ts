import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean, failureOf, phaseOf } from '../../../src/features/computers/enroll-steps.ts'

const name = 'box'
const kind = (error: string, url: string | null = null) => failureOf({ error, url, name, here: 'computer' }).kind

test('known install failures map to a plain sentence', () => {
  assert.equal(kind('The install stopped: openhut: another install or update is already running'), 'busy')
  assert.equal(kind('The install stopped: tailscale ssh exited with 1', 'https://login.tailscale.com/a/abc'), 'approve')
  assert.equal(kind('The install stopped: ssh: connect to host box port 22: Connection refused'), 'unreachable')
  assert.equal(kind("https://box didn't accept that key (it answered 401)."), 'key')
  assert.equal(kind("OpenHut is installed, but https://box didn't answer within 2 minutes."), 'timeout')
  assert.equal(failureOf({ error: 'Something new', url: null, name, here: 'computer' }).sentence, "Couldn't install OpenHut. Check the computer is on and try again.")
})

test('the installer\'s lines become one plain word for where the add is', () => {
  assert.equal(clean('\u001b[1m==>\u001b[0m gVisor 20261109.0'), '==> gVisor 20261109.0')
  assert.equal(phaseOf([]), 'Connecting…')
  assert.equal(phaseOf(['Installing OpenHut on box over Tailscale SSH']), 'Connecting…')
  assert.equal(phaseOf(['Installing OpenHut on box over Tailscale SSH', '\u001b[1m==>\u001b[0m OpenHut container', '[1m==>[0m Claude Code 2.1.311']), 'Installing…')
  assert.equal(phaseOf(['==> gVisor 20261109.0', '==> Starting']), 'Starting…')
  assert.equal(phaseOf(['==> Starting', 'Waiting for https://box to answer']), 'Almost ready…')
})
