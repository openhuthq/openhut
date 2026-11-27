import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attempt, evaluate } from '../../../src/server/inbox/expressions.ts'

test('a function runs on a copy of the payload and its result comes back as a copy', async () => {
  const payload = { workflow_run: { id: 7, run_attempt: 2 } }
  assert.equal(await evaluate('p => `${p.workflow_run.id}/${p.workflow_run.run_attempt}`', payload), '7/2')
  assert.equal(await evaluate('p => { p.workflow_run.id = 9; return p.workflow_run.id }', payload), 9)
  assert.equal(payload.workflow_run.id, 7)
  assert.deepEqual(await evaluate('p => ({ title: p.name, n: [1, 2] })', { name: 'x' }), { title: 'x', n: [1, 2] })
})

test('nothing outside the payload is reachable', async () => {
  assert.equal(await evaluate('p => [typeof process, typeof require, typeof fetch, typeof setTimeout].join()', {}), 'undefined,undefined,undefined,undefined')
})

test('a throw, a syntax error, a timeout or running out of memory is undefined with the reason', async () => {
  assert.equal(await evaluate('p => p.a.b', {}), undefined)
  assert.match((await attempt({ source: 'p => p.a.b', payload: {} })).error ?? '', /Cannot read properties of undefined/)
  assert.match((await attempt({ source: 'p => (', payload: {} })).error ?? '', /Unexpected token/)
  const started = Date.now()
  assert.match((await attempt({ source: 'p => { for (;;) {} }', payload: {} })).error ?? '', /timed out/)
  assert.ok(Date.now() - started < 1000)
  assert.ok((await attempt({ source: 'p => { const all = []; for (;;) all.push(new Array(1e6).fill(1)) }', payload: {} })).error)
  assert.equal(await evaluate('p => p.ok', { ok: true }), true, 'the next call still works')
})

test('a result over 4 KB and a payload over 256 KB are refused', async () => {
  assert.match((await attempt({ source: 'p => "x".repeat(5000)', payload: {} })).error ?? '', /over 4 KB/)
  assert.match((await attempt({ source: 'p => 1', payload: { big: 'x'.repeat(256 * 1024) } })).error ?? '', /over 256 KB/)
})
