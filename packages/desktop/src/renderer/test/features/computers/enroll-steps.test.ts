import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean, detailsOf, failureOf, percentOf, phaseOf, stageOf } from '../../../src/features/computers/enroll-steps.ts'

const name = 'box'
const kind = (error: string, url: string | null = null) => failureOf({ error, url, name }).kind

test('known install failures map to a plain sentence', () => {
  assert.equal(kind('The install stopped: openhut: another install or update is already running'), 'busy')
  assert.equal(kind('The install stopped: tailscale ssh exited with 1', 'https://login.tailscale.com/a/abc'), 'approve')
  assert.equal(kind('The install stopped: ssh: connect to host box port 22: Connection refused'), 'unreachable')
  assert.equal(kind("OpenHut is installed, but box didn't answer within 2 minutes."), 'silent')
  assert.equal(kind('This code expired. Make a new one.'), 'timeout')
  assert.equal(failureOf({ error: 'Something new', url: null, name }).sentence, "Couldn't install OpenHut. Check the computer is on and try again.")
})

test('the installer\'s lines become one plain word for where the add is', () => {
  assert.equal(clean('\u001b[1m==>\u001b[0m gVisor 20261109.0'), '==> gVisor 20261109.0')
  assert.equal(phaseOf([]), 'Connecting…')
  assert.equal(phaseOf(['Installing OpenHut on box over Tailscale SSH']), 'Connecting…')
  assert.equal(phaseOf(['Installing OpenHut on box over Tailscale SSH', '\u001b[1m==>\u001b[0m OpenHut container', '[1m==>[0m Claude Code 2.1.311']), 'Installing…')
  assert.equal(phaseOf(['==> gVisor 20261109.0', '==> Starting']), 'Starting…')
  assert.equal(phaseOf(['==> Starting', 'Waiting for box to join']), 'Almost ready…')
})

test('each phase is a step further along, in plain words', () => {
  const lines = [[], ['==> Docker'], ['==> Starting'], ['==> Starting', 'Waiting for box to join']]
  const stages = lines.map(stageOf)
  assert.deepEqual(stages.map((each) => each.line), ['Connecting', 'Installing OpenHut', 'Starting', 'Almost ready'])
  assert.deepEqual(stages.map((each) => each.at), [...stages.map((each) => each.at)].sort((a, b) => a - b))
})

test('the percentage moves within a phase: one step per installer line, then with time while it waits to join', () => {
  const now = 1_000_000
  assert.equal(percentOf({ lines: [], now }), 12)
  assert.equal(percentOf({ lines: ['==> Docker', '==> gVisor'], now }), 51)
  assert.equal(percentOf({ lines: Array(40).fill('==> step'), now }), 74)
  const waiting = ['==> Starting', 'Waiting for box to join']
  assert.equal(percentOf({ lines: waiting, waitingAt: now, now }), 92)
  assert.equal(percentOf({ lines: waiting, waitingAt: now + 900, now }), 92)
  assert.equal(percentOf({ lines: waiting, waitingAt: now - 60_000, now }), 95)
  assert.equal(percentOf({ lines: waiting, waitingAt: now - 600_000, now }), 99)
})

test('the details to copy hold the version, the address, every line, the error and the computer\'s log', () => {
  const enrollment = { peer: { name: 'box', dns: 'box.tail.ts.net' }, lines: ['\u001b[1m==>\u001b[0m OpenHut container'], error: "OpenHut is installed, but box didn't answer within 2 minutes.", log: 'app.started' }
  assert.equal(detailsOf({ enrollment, version: '0.3.2' }), "OpenHut 0.3.2 adding box.tail.ts.net\n==> OpenHut container\nOpenHut is installed, but box didn't answer within 2 minutes.\n\nbox's log:\napp.started")
})
