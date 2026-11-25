import assert from 'node:assert/strict'
import { text } from 'node:stream/consumers'
import { test } from 'node:test'
import type { Duplex } from 'node:stream'
import { mux, type Mux } from '../../src/tunnel/mux.ts'

function pair(accept: { a?: (open: Record<string, unknown>, stream: Duplex) => void; b?: (open: Record<string, unknown>, stream: Duplex) => void } = {}) {
  const heard: Record<string, unknown>[] = []
  const sides: { a?: Mux; b?: Mux } = {}
  sides.a = mux({ odd: true, send: (bytes, done) => { queueMicrotask(() => sides.b!.receive(bytes)); done() }, accept: accept.a ?? (() => {}), heard: (m) => heard.push(m) })
  sides.b = mux({ odd: false, send: (bytes, done) => { queueMicrotask(() => sides.a!.receive(bytes)); done() }, accept: accept.b ?? (() => {}), heard: (m) => heard.push(m) })
  return { a: sides.a, b: sides.b, heard }
}

test('a stream carries bytes both ways and half-closes', async () => {
  const { a } = pair({ b: (open, stream) => {
    let got = ''
    stream.on('data', (chunk: Buffer) => { got += chunk })
    stream.on('end', () => stream.end(`${String(open.to)}:${got.toUpperCase()}`))
  } })
  const stream = a.open({ to: 'echo' })
  stream.end('x'.repeat(200_000))
  assert.equal(await text(stream), `echo:${'X'.repeat(200_000)}`)
})

test('either side opens streams and control messages arrive', async () => {
  const { a, b, heard } = pair({ a: (_open, stream) => stream.end('from a') })
  const stream = b.open({})
  stream.end()
  assert.equal(await text(stream), 'from a')
  a.say({ type: 'hello' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(heard, [{ type: 'hello' }])
})

test('closing the link ends its streams', async () => {
  const { a } = pair({ b: () => {} })
  const stream = a.open({})
  const closed = new Promise((resolve) => stream.on('close', resolve))
  a.close()
  await closed
  assert.equal(stream.destroyed, true)
})
