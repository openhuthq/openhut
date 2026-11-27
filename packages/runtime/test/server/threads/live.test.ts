import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { LiveDown } from '@openhut/common/live.ts'
import { liveThreads } from '../../../src/server/threads/live.ts'

function viewer(id: string) {
  const heard: LiveDown[] = []
  return { heard, key: {}, viewer: { person: { id, name: id, email: `${id}@example.com` }, send: (message: LiveDown) => heard.push(message) } }
}

test('typing shows on everyone\'s presence and ends by itself 5 s after the last keystroke', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const ana = viewer('ana')
    const bo = viewer('bo')
    liveThreads.join({ thread: 'th_typing', agentId: 'ag_live', ...ana })
    liveThreads.join({ thread: 'th_typing', agentId: 'ag_live', ...bo })
    liveThreads.typing({ thread: 'th_typing', key: ana.key, on: true })
    const states = () => bo.heard.flatMap((each) => each.type === 'presence' ? [each.people.map((person) => `${person.id}:${person.state}`).join(',')] : [])
    assert.equal(states().at(-1), 'ana:typing,bo:viewing')
    mock.timers.tick(4000)
    liveThreads.typing({ thread: 'th_typing', key: ana.key, on: true })
    mock.timers.tick(4000)
    assert.equal(states().at(-1), 'ana:typing,bo:viewing')
    mock.timers.tick(1000)
    assert.equal(states().at(-1), 'ana:viewing,bo:viewing')
    liveThreads.leave({ thread: 'th_typing', key: ana.key })
    assert.equal(states().at(-1), 'bo:viewing')
    liveThreads.drop(bo.key)
  } finally {
    mock.timers.reset()
  }
})

test('a turn shows thinking, working and replying to viewers, and idle once it ends', () => {
  const ana = viewer('ana')
  liveThreads.join({ thread: 'th_batch', agentId: 'ag_live', ...ana })
  const turn = liveThreads.turn({ thread: 'th_batch', agentId: 'ag_live', turnId: 'msg_1', answering: ['ana@example.com'] })
  turn.replying()
  turn.replying()
  turn.step('Search the web')
  turn.replying()
  turn.end()
  const agents = ana.heard.flatMap((each) => each.type === 'presence' ? [[each.agent.state, each.agent.step].filter(Boolean).join(':')] : [])
  assert.deepEqual(agents, ['idle', 'thinking', 'replying', 'working:Search the web', 'replying', 'idle'])
  liveThreads.drop(ana.key)
})

test('the board lists each agent\'s busy or typed-in threads and its sub-agents, and tells watchers when it changes', () => {
  let changes = 0
  liveThreads.watch(() => { changes++ })
  const ana = viewer('ana')
  liveThreads.join({ thread: 'th_board', agentId: 'ag_board', ...ana })
  assert.equal(liveThreads.board().get('ag_board'), undefined)
  liveThreads.typing({ thread: 'th_board', key: ana.key, on: true })
  assert.deepEqual(liveThreads.board().get('ag_board'), { threads: [{ id: 'th_board', agent: { state: 'idle' }, typing: [ana.viewer.person] }], subagents: [] })
  liveThreads.typing({ thread: 'th_board', key: ana.key, on: false })
  const turn = liveThreads.turn({ thread: 'th_away', agentId: 'ag_board', turnId: 'msg_2', answering: [] })
  turn.step('Run a command')
  assert.deepEqual(liveThreads.board().get('ag_board')?.threads, [{ id: 'th_away', agent: { state: 'working', step: 'Run a command', turnId: 'msg_2' }, typing: [] }])
  const sub = { id: 's1', object: 'subagent' as const, title: 'Look', status: 'working' as const, startedAt: new Date(0).toISOString() }
  liveThreads.subagents({ agentId: 'ag_board', list: [sub] })
  assert.deepEqual(liveThreads.board().get('ag_board')?.subagents, [sub])
  turn.end()
  liveThreads.subagents({ agentId: 'ag_board', list: [] })
  assert.equal(liveThreads.board().get('ag_board'), undefined)
  assert.equal(changes, 7)
  liveThreads.drop(ana.key)
})
