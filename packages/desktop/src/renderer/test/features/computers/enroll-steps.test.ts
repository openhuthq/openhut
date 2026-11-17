import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean, failureOf, stepsOf } from '../../../src/features/computers/enroll-steps.ts'

const name = 'box'
const kind = (error: string, url: string | null = null) => failureOf({ error, url, name }).kind

test('known install failures map to a plain sentence', () => {
  assert.equal(kind('The install stopped: openhut: another install or update is already running'), 'busy')
  assert.equal(kind('The install stopped: tailscale ssh exited with 1', 'https://login.tailscale.com/a/abc'), 'approve')
  assert.equal(kind('The install stopped: ssh: connect to host box port 22: Connection refused'), 'unreachable')
  assert.equal(kind("https://box didn't accept that key (it answered 401)."), 'key')
  assert.equal(kind("OpenHut is installed, but https://box didn't answer within 2 minutes."), 'timeout')
  assert.equal(kind('Something new'), 'other')
  assert.equal(failureOf({ error: 'x', url: null, name }).sentence, "Couldn't add box.")
})

test('installer lines lose their colour codes and move the steps forward', () => {
  assert.equal(clean('\u001b[1m==>\u001b[0m gVisor 20261109.0'), '==> gVisor 20261109.0')
  assert.equal(clean('[1m==>[0m OpenHut container'), '==> OpenHut container')
  const steps = stepsOf({ lines: ['Installing OpenHut on box over Tailscale SSH', '\u001b[1m==>\u001b[0m OpenHut container', '\u001b[1m==>\u001b[0m gVisor 20261109.0', '\u001b[1m==>\u001b[0m Claude Code 2.1.311'], failed: false })
  assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'done', 'now', 'next', 'next'])
  assert.equal(steps[2].detail, 'gVisor 20261109.0')
  assert.equal(stepsOf({ lines: [], failed: true })[0].state, 'failed')
})
