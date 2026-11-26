import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { liveThreads, namesLine, typingLine, type LiveSnapshot } from '../../src/lib/thread-live.ts'

const sent: object[] = []
let snapshot: LiveSnapshot = { turnId: null, seq: 0, text: '', agent: { state: 'idle' } }
let refetched: string[] = []

beforeEach(() => {
  liveThreads.reset()
  sent.length = 0
  refetched = []
  snapshot = { turnId: null, seq: 0, text: '', agent: { state: 'idle' } }
  liveThreads.connect({ send: (message) => sent.push(message), fetchLive: async () => snapshot, refetch: async (thread) => void refetched.push(thread) })
})

const delta = (seq: number, text: string, turnId = 'turn_1') => liveThreads.receive({ type: 'delta', thread: 'th_1', turnId, seq, text })

test('deltas join in seq order, whatever order they arrive in, and repeats are dropped', () => {
  liveThreads.receive({ type: 'turn', thread: 'th_1', turnId: 'turn_1', state: 'started' })
  delta(2, ' world')
  assert.equal(liveThreads.get('th_1').stream?.text, '')
  delta(1, 'Hello')
  delta(1, 'Hello')
  delta(3, '!')
  assert.deepEqual({ text: liveThreads.get('th_1').stream?.text, seq: liveThreads.get('th_1').stream?.seq }, { text: 'Hello world!', seq: 3 })
})

test('joining mid-turn keeps early deltas until the catch-up fills the start', async () => {
  delta(5, ' more')
  snapshot = { turnId: 'turn_1', seq: 4, text: 'Up to four', agent: { state: 'replying', answering: ['Mo'] } }
  liveThreads.join('th_1')
  assert.deepEqual(sent, [{ type: 'join', thread: 'th_1' }])
  await liveThreads.catchUp('th_1')
  assert.equal(liveThreads.get('th_1').stream?.text, 'Up to four more')
  assert.equal(liveThreads.get('th_1').agent.state, 'replying')
  delta(6, '.')
  assert.equal(liveThreads.get('th_1').stream?.text, 'Up to four more.')
})

test('a catch-up older than what streamed already changes nothing', async () => {
  delta(1, 'a')
  delta(2, 'b')
  snapshot = { turnId: 'turn_1', seq: 1, text: 'a', agent: { state: 'replying' } }
  await liveThreads.catchUp('th_1')
  assert.equal(liveThreads.get('th_1').stream?.text, 'ab')
})

test('a done turn clears only after the messages refetch', async () => {
  delta(1, 'Hi')
  const done = liveThreads.finish({ thread: 'th_1', turnId: 'turn_1' })
  assert.equal(liveThreads.get('th_1').stream?.text, 'Hi')
  await done
  assert.deepEqual(refetched, ['th_1'])
  assert.equal(liveThreads.get('th_1').stream, undefined)
})

test('a reconnect joins every open thread again; the last leave sends leave', () => {
  liveThreads.join('th_1')
  liveThreads.join('th_1')
  liveThreads.join('th_2')
  sent.length = 0
  liveThreads.opened()
  assert.deepEqual(sent, [{ type: 'join', thread: 'th_1' }, { type: 'join', thread: 'th_2' }])
  sent.length = 0
  liveThreads.leave('th_1')
  assert.deepEqual(sent, [])
  liveThreads.leave('th_1')
  assert.deepEqual(sent, [{ type: 'leave', thread: 'th_1' }])
})

test('typing and answering lines read naturally', () => {
  assert.equal(typingLine([]), '')
  assert.equal(typingLine(['Sara']), 'Sara is typing')
  assert.equal(typingLine(['Sara', 'Ahmed']), 'Sara and Ahmed are typing')
  assert.equal(typingLine(['Sara', 'Ahmed', 'Jake']), '3 people are typing')
  assert.equal(namesLine(['Mo', 'Ahmed']), 'Mo and Ahmed')
  assert.equal(namesLine(['Mo', 'Ahmed', 'Sara']), 'Mo, Ahmed and Sara')
})
