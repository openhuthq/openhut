import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { agentWorking, busyOf, liveThreads, namesLine, presenceOf, typingLine } from '../../src/lib/thread-live.ts'

const sent: object[] = []
let refetched: string[] = []

beforeEach(() => {
  liveThreads.reset()
  sent.length = 0
  refetched = []
  liveThreads.connect({ send: (message) => sent.push(message), refetch: async (thread) => void refetched.push(thread) })
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

test('coming back to the tab refetches every open thread, so a turn that started or ended meanwhile shows', () => {
  liveThreads.join('th_1')
  liveThreads.join('th_2')
  liveThreads.leave('th_2')
  liveThreads.refresh()
  assert.deepEqual(refetched, ['th_1'])
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

test('a thread is working when its own presence or the agents board says so, and the agent works while one of its threads or sub-agents does', () => {
  const idle = { state: 'idle' as const }
  const working = { state: 'working' as const }
  assert.equal(busyOf({ live: { people: [], agent: idle }, board: { id: 'th_1', agent: working, typing: [] } }), true)
  assert.equal(busyOf({ live: { people: [], agent: working }, board: undefined }), true)
  assert.equal(busyOf({ live: undefined, board: { id: 'th_1', agent: idle, typing: [] } }), false)
  const agent = (state: 'idle' | 'working') => ({ id: 'ag_1', activity: 'idle' as const, status: 'running' as const, health: null, subagents: [], threads: [{ id: 'th_1', agent: { state }, typing: [] }] })
  assert.equal(agentWorking(agent('working')), true)
  assert.equal(agentWorking(agent('idle')), false)
  assert.equal(agentWorking({ ...agent('idle'), subagents: [{ id: 'sa_1', object: 'subagent' as const, title: 'Check payouts', status: 'working' as const, startedAt: '2026-11-27T10:00:00Z' }] }), true, 'a running sub-agent counts')
  assert.equal(agentWorking(undefined), false)
})
