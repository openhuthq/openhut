import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Invitation, joinCommand, spaced } from '../../../src/features/settings/invitation.ts'

test('the six digits read as two groups of three, as the phone shows them', () => {
  assert.equal(spaced('482913'), '482 913')
  assert.equal(spaced('000042'), '000 042')
})

test('the join command quotes the code, so the shell keeps its & and ? as they are', () => {
  const code = 'openhut://join?c=ab&k=cd&o=ef&s=12&r=wss://cloud.openhut.dev'
  assert.equal(joinCommand(code), `curl -fsSL openhut.dev | sh -s -- join '${code}'`)
  assert.equal(joinCommand("x'; rm -rf ~; '"), "curl -fsSL openhut.dev | sh -s -- join 'x; rm -rf ~; '")
})

test('a joined invitation carries who joined and the digits; a new one only its code', () => {
  assert.ok(Invitation.safeParse({ object: 'invitation', id: 'inv_1', code: 'openhut://join?c=ab', expiresAt: '2026-11-18T10:00:00.000Z' }).success)
  const joined = Invitation.safeParse({ object: 'invitation', id: 'inv_1', status: 'joined', device: { name: 'Mo\'s iPhone', kind: 'client', key: 'ab'.repeat(32) }, digits: '482913' })
  assert.equal(joined.success && joined.data.device?.name, 'Mo\'s iPhone')
  assert.equal(Invitation.safeParse({ object: 'invitation', id: 'inv_1', status: 'gone' }).success, false)
})
