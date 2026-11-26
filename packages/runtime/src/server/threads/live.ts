import { LIVE_DELTA_MS, LIVE_TYPING_MS, type AgentLive, type LiveDown, type LivePerson, type ThreadLive } from '@openhut/common/live.ts'

export type Viewer = { person: Omit<LivePerson, 'state'>; send: (message: LiveDown) => void }
export type LiveTurnHandle = { delta: (input: { part: string; text: string }) => void; step: (label: string) => void; end: () => void }
type Turn = { turnId: string; seq: number; text: string; buffer: string; part?: string; timer?: NodeJS.Timeout }

const IDLE: AgentLive = { state: 'idle' }
const rooms = new Map<string, Map<object, Viewer>>()
const typists = new Map<string, Map<string, NodeJS.Timeout>>()
const agents = new Map<string, AgentLive>()
const turns = new Map<string, Turn>()

export const liveThreads = {
  join({ thread, key, viewer }: { thread: string; key: object; viewer: Viewer }): void {
    const room = rooms.get(thread) ?? new Map<object, Viewer>()
    rooms.set(thread, room)
    room.set(key, viewer)
    presence(thread)
  },

  leave({ thread, key }: { thread: string; key: object }): void {
    const room = rooms.get(thread)
    const viewer = room?.get(key)
    if (!room || !viewer) return
    room.delete(key)
    if (![...room.values()].some((each) => each.person.id === viewer.person.id)) stopTyping({ thread, person: viewer.person.id })
    if (!room.size) rooms.delete(thread)
    presence(thread)
  },

  drop(key: object): void {
    for (const [thread, room] of rooms) if (room.has(key)) liveThreads.leave({ thread, key })
  },

  typing({ thread, key, on }: { thread: string; key: object; on: boolean }): void {
    const person = rooms.get(thread)?.get(key)?.person.id
    if (!person) return
    const typing = typists.get(thread) ?? new Map<string, NodeJS.Timeout>()
    const was = typing.has(person)
    clearTimeout(typing.get(person))
    typing.delete(person)
    if (on) {
      typing.set(person, setTimeout(() => {
        stopTyping({ thread, person })
        presence(thread)
      }, LIVE_TYPING_MS).unref())
      typists.set(thread, typing)
    }
    if (!typing.size) typists.delete(thread)
    if (was !== on) presence(thread)
  },

  turn({ thread, turnId, answering }: { thread: string; turnId: string; answering: string[] }): LiveTurnHandle {
    const turn: Turn = { turnId, seq: 0, text: '', buffer: '' }
    turns.set(thread, turn)
    const flush = () => {
      clearTimeout(turn.timer)
      turn.timer = undefined
      if (!turn.buffer || turns.get(thread) !== turn) return
      const text = turn.buffer
      turn.buffer = ''
      turn.text += text
      broadcast({ thread, message: { type: 'delta', thread, turnId, seq: ++turn.seq, text } })
    }
    const setAgent = (agent: AgentLive) => {
      const now = agents.get(thread)
      if (now?.state === agent.state && now.step === agent.step) return
      agents.set(thread, agent)
      presence(thread)
    }
    const base = { turnId, ...answering.length && { answering } }
    broadcast({ thread, message: { type: 'turn', thread, turnId, state: 'started' } })
    setAgent({ state: 'thinking', ...base })
    return {
      delta: ({ part, text }) => {
        if (!text || turns.get(thread) !== turn) return
        if (turn.part !== part && (turn.text || turn.buffer)) turn.buffer += '\n\n'
        turn.part = part
        turn.buffer += text
        turn.timer ??= setTimeout(flush, LIVE_DELTA_MS).unref()
        setAgent({ state: 'replying', ...base })
      },
      step: (label) => {
        if (turns.get(thread) !== turn) return
        flush()
        setAgent({ state: 'working', step: label, ...base })
      },
      end: () => {
        if (turns.get(thread) !== turn) return
        flush()
        turns.delete(thread)
        agents.delete(thread)
        broadcast({ thread, message: { type: 'turn', thread, turnId, state: 'done' } })
        presence(thread)
      },
    }
  },

  catchUp(thread: string): ThreadLive {
    const turn = turns.get(thread)
    return { object: 'thread_live', thread, turnId: turn?.turnId ?? null, seq: turn?.seq ?? 0, text: turn?.text ?? '', agent: agents.get(thread) ?? IDLE }
  },
}

function stopTyping({ thread, person }: { thread: string; person: string }): void {
  const typing = typists.get(thread)
  clearTimeout(typing?.get(person))
  typing?.delete(person)
  if (typing && !typing.size) typists.delete(thread)
}

function presence(thread: string): void {
  const room = rooms.get(thread)
  if (!room) return
  const typing = typists.get(thread)
  const people = new Map<string, LivePerson>()
  for (const { person } of room.values()) people.set(person.id, { ...person, state: typing?.has(person.id) ? 'typing' : 'viewing' })
  broadcast({ thread, message: { type: 'presence', thread, people: [...people.values()], agent: agents.get(thread) ?? IDLE } })
}

function broadcast({ thread, message }: { thread: string; message: LiveDown }): void {
  for (const viewer of rooms.get(thread)?.values() ?? []) viewer.send(message)
}
