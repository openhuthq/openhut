import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { liveThreads, namesLine, presenceOf, typingLine, type LiveSnapshot } from '../../src/lib/thread-live.ts'

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

test('a thread nobody opened reads its typing and agent state from the agents board, and an open one from its own presence', () => {
  const board = (typing: { id: string; name: string; email: string }[], state: 'idle' | 'replying') => liveThreads.receive({ type: 'agents', agents: [{ id: 'ag_1', activity: state === 'replying' ? 'working' : 'idle', status: 'running', health: 'answering', subagents: [], threads: state === 'idle' && !typing.length ? [] : [{ id: 'th_2', agent: { state }, typing }] }] })
  board([{ id: 'u2', name: 'Sara', email: 'sara@example.com' }], 'replying')
  const seen = presenceOf(liveThreads.board('th_2'))
  assert.deepEqual(seen.typing.map((person) => person.name), ['Sara'])
  assert.equal(seen.agent.state, 'replying')
  assert.equal(liveThreads.agents().get('ag_1')?.activity, 'working')
  board([], 'idle')
  assert.equal(presenceOf(liveThreads.board('th_2')).agent.state, 'idle')
  liveThreads.join('th_2')
  liveThreads.receive({ type: 'presence', thread: 'th_2', people: [{ id: 'u1', name: 'Mo', email: 'mo@example.com', state: 'viewing' }], agent: { state: 'idle' } })
  assert.equal(liveThreads.joined('th_2'), true)
  liveThreads.leave('th_2')
  assert.equal(liveThreads.joined('th_2'), false)
  assert.deepEqual(liveThreads.get('th_2').people, [])
})

test('a turn that starts before the last one refetched keeps the last text until its refetch', async () => {
  delta(1, 'First answer')
  const done = liveThreads.finish({ thread: 'th_1', turnId: 'turn_1' })
  liveThreads.receive({ type: 'turn', thread: 'th_1', turnId: 'turn_2', state: 'started' })
  delta(1, 'Second', 'turn_2')
  assert.deepEqual(liveThreads.get('th_1').ending?.map((stream) => stream.text), ['First answer'])
  assert.equal(liveThreads.get('th_1').stream?.text, 'Second')
  await done
  assert.deepEqual(liveThreads.get('th_1').ending, [])
  assert.equal(liveThreads.get('th_1').stream?.text, 'Second')
})
