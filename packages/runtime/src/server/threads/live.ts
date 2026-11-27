import type { Subagent } from '@openhut/common/agents/subagent.ts'
import { LIVE_TYPING_MS, type AgentLive, type LiveDown, type LivePerson, type LiveThreadBoard } from '@openhut/common/live.ts'

export type Viewer = { person: Omit<LivePerson, 'state'>; send: (message: LiveDown) => void }
export type LiveTurnHandle = { replying: () => void; step: (label: string) => void; end: () => void }

const IDLE: AgentLive = { state: 'idle' }
const rooms = new Map<string, Map<object, Viewer>>()
const typists = new Map<string, Map<string, NodeJS.Timeout>>()
const agents = new Map<string, AgentLive>()
const turns = new Map<string, string>()
const owners = new Map<string, string>()
const subagents = new Map<string, Subagent[]>()
const watchers: (() => void)[] = []

export const liveThreads = {
  join({ thread, agentId, key, viewer }: { thread: string; agentId: string; key: object; viewer: Viewer }): void {
    owners.set(thread, agentId)
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
    forget(thread)
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
        changed()
      }, LIVE_TYPING_MS).unref())
      typists.set(thread, typing)
    }
    if (!typing.size) typists.delete(thread)
    if (was !== on) {
      presence(thread)
      changed()
    }
  },

  turn({ thread, agentId, turnId, answering }: { thread: string; agentId: string; turnId: string; answering: string[] }): LiveTurnHandle {
    turns.set(thread, turnId)
    owners.set(thread, agentId)
    const mine = () => turns.get(thread) === turnId
    const setAgent = (agent: AgentLive) => {
      const now = agents.get(thread)
      if (!mine() || (now?.state === agent.state && now.step === agent.step)) return
      agents.set(thread, agent)
      presence(thread)
      changed()
    }
    const base = { turnId, ...answering.length && { answering } }
    setAgent({ state: 'thinking', ...base })
    return {
      replying: () => setAgent({ state: 'replying', ...base }),
      step: (label) => setAgent({ state: 'working', step: label, ...base }),
      end: () => {
        if (!mine()) return
        turns.delete(thread)
        agents.delete(thread)
        presence(thread)
        forget(thread)
        changed()
      },
    }
  },

  board(): Map<string, { threads: LiveThreadBoard[]; subagents: Subagent[] }> {
    const board = new Map<string, { threads: LiveThreadBoard[]; subagents: Subagent[] }>()
    const of = (agentId: string) => {
      const found = board.get(agentId) ?? { threads: [], subagents: [] }
      board.set(agentId, found)
      return found
    }
    for (const [thread, agentId] of owners) {
      const typing = typingPeople(thread)
      const agent = agents.get(thread) ?? IDLE
      if (agent.state !== 'idle' || typing.length) of(agentId).threads.push({ id: thread, agent, typing })
    }
    for (const [agentId, list] of subagents) of(agentId).subagents = list
    return board
  },

  subagents({ agentId, list }: { agentId: string; list: Subagent[] }): void {
    if (list.length) subagents.set(agentId, list)
    else subagents.delete(agentId)
    changed()
  },

  watch(listener: () => void): void {
    watchers.push(listener)
  }
}

function typingPeople(thread: string): Omit<LivePerson, 'state'>[] {
  const typing = typists.get(thread)
  if (!typing) return []
  const people = new Map<string, Omit<LivePerson, 'state'>>()
  for (const { person } of rooms.get(thread)?.values() ?? []) if (typing.has(person.id)) people.set(person.id, person)
  return [...people.values()]
}

function forget(thread: string): void {
  if (!rooms.has(thread) && !turns.has(thread)) owners.delete(thread)
}

function changed(): void {
  for (const listener of watchers) listener()
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
