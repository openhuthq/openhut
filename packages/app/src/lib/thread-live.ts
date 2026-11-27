import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import * as z from 'zod/mini'
import type { AgentLive, LiveAgentBoard, LivePerson, LiveThreadBoard } from '@openhut/common/live.ts'
import { AgentHealth, AgentStatus } from '@openhut/common/agents/agent.ts'
import { Subagent } from '@openhut/common/agents/subagent.ts'

export type { AgentLive, LiveAgentBoard, LivePerson }

const Person = z.object({ id: z.string(), name: z.string(), email: z.string(), state: z.enum(['viewing', 'typing']) })
const AgentState = z.object({ state: z.enum(['idle', 'thinking', 'working', 'replying']), step: z.optional(z.string()), turnId: z.optional(z.string()), answering: z.optional(z.array(z.string())) })
export const ThreadEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('presence'), thread: z.string(), people: z.array(Person), agent: AgentState }),
  z.object({ type: z.literal('agents'), agents: z.array(z.object({
    id: z.string(),
    activity: z.enum(['idle', 'working', 'waiting']),
    status: AgentStatus,
    health: z.nullable(AgentHealth),
    threads: z.array(z.object({ id: z.string(), agent: AgentState, typing: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })) })),
    subagents: z.array(Subagent),
  })) }),
])
export type ThreadEvent = z.infer<typeof ThreadEvent>

export type ThreadLive = { people: LivePerson[]; agent: AgentLive }
type Wire = { send: (message: object) => void; refetch: (thread: string) => Promise<unknown> }

const IDLE: AgentLive = { state: 'idle' }
const EMPTY: ThreadLive = { people: [], agent: IDLE }
const TYPING_MS = 3000
const TYPING_IDLE_MS = 5000

const threads = new Map<string, ThreadLive>()
let agents = new Map<string, LiveAgentBoard>()
let boardThreads = new Map<string, LiveThreadBoard>()
const joined = new Map<string, number>()
const listeners = new Set<() => void>()
let wire: Wire | undefined
let frame: number | undefined

function notify() {
  if (frame !== undefined) return
  const run = () => {
    frame = undefined
    for (const listener of listeners) listener()
  }
  frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number)
}

function put(thread: string, change: (live: ThreadLive) => ThreadLive) {
  threads.set(thread, change(threads.get(thread) ?? EMPTY))
  notify()
}

export const liveThreads = {
  connect(next: Wire) {
    wire = next
  },
  opened() {
    for (const thread of joined.keys()) wire?.send({ type: 'join', thread })
  },
  refresh() {
    for (const thread of joined.keys()) void wire?.refetch(thread).catch(() => undefined)
  },
  receive(event: ThreadEvent) {
    if (event.type === 'agents') {
      agents = new Map(event.agents.map((agent) => [agent.id, agent]))
      boardThreads = new Map(event.agents.flatMap((agent) => agent.threads.map((thread) => [thread.id, thread])))
      return notify()
    }
    put(event.thread, (live) => ({ ...live, people: event.people, agent: event.agent }))
  },
  join(thread: string) {
    const count = joined.get(thread) ?? 0
    joined.set(thread, count + 1)
    if (count) return
    wire?.send({ type: 'join', thread })
  },
  leave(thread: string) {
    const count = (joined.get(thread) ?? 1) - 1
    if (count > 0) return void joined.set(thread, count)
    joined.delete(thread)
    threads.delete(thread)
    wire?.send({ type: 'leave', thread })
  },
  typing({ thread, on }: { thread: string; on: boolean }) {
    wire?.send({ type: 'typing', thread, on })
  },
  get(thread: string): ThreadLive {
    return threads.get(thread) ?? EMPTY
  },
  board(thread: string): LiveThreadBoard | undefined {
    return boardThreads.get(thread)
  },
  joined(thread: string): boolean {
    return joined.has(thread)
  },
  agents(): Map<string, LiveAgentBoard> {
    return agents
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
  reset() {
    threads.clear()
    joined.clear()
    agents = new Map()
    boardThreads = new Map()
    wire = undefined
  },
}

export function typingLine(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names.length} people are typing`
}

export function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function useJoinThread(thread: string): void {
  useEffect(() => {
    liveThreads.join(thread)
    return () => liveThreads.leave(thread)
  }, [thread])
}

export function presenceOf(live: ThreadLive | LiveThreadBoard | undefined): { people: LivePerson[]; typing: LivePerson[]; agent: AgentLive } {
  if (!live) return { people: [], typing: [], agent: IDLE }
  if ('typing' in live) {
    const typing = live.typing.map((person) => ({ ...person, state: 'typing' as const }))
    return { people: typing, typing, agent: live.agent }
  }
  return { people: live.people, typing: live.people.filter((person) => person.state === 'typing'), agent: live.agent }
}

export function usePresence(thread: string): { people: LivePerson[]; typing: LivePerson[]; agent: AgentLive } {
  return presenceOf(useSyncExternalStore(liveThreads.subscribe, () => liveThreads.joined(thread) ? liveThreads.get(thread) : liveThreads.board(thread)))
}

export function busyOf({ live, board }: { live: ThreadLive | undefined; board: LiveThreadBoard | undefined }): boolean {
  return [live, board].some((each) => !!each && each.agent.state !== 'idle')
}

export function useWorking(thread: string): boolean {
  return useSyncExternalStore(liveThreads.subscribe, () => busyOf({ live: liveThreads.joined(thread) ? liveThreads.get(thread) : undefined, board: liveThreads.board(thread) }))
}

export function agentWorking(board: LiveAgentBoard | undefined): boolean {
  return !!board && (board.threads.some((thread) => thread.agent.state !== 'idle') || board.subagents.some((child) => child.status === 'working'))
}

export function useAgentsLive(): Map<string, LiveAgentBoard> {
  return useSyncExternalStore(liveThreads.subscribe, liveThreads.agents)
}

export function useTyping(thread: string): { ping: () => void; stop: () => void } {
  const last = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const stop = useCallback(() => {
    clearTimeout(idle.current)
    if (!last.current) return
    last.current = 0
    liveThreads.typing({ thread, on: false })
  }, [thread])
  const ping = useCallback(() => {
    clearTimeout(idle.current)
    idle.current = setTimeout(stop, TYPING_IDLE_MS)
    if (Date.now() - last.current < TYPING_MS) return
    last.current = Date.now()
    liveThreads.typing({ thread, on: true })
  }, [thread, stop])
  useEffect(() => stop, [stop])
  return { ping, stop }
}
