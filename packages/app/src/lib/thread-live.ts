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
  z.object({ type: z.literal('delta'), thread: z.string(), turnId: z.string(), seq: z.number(), text: z.string() }),
  z.object({ type: z.literal('turn'), thread: z.string(), turnId: z.string(), state: z.enum(['started', 'done']) }),
  z.object({ type: z.literal('agents'), agents: z.array(z.object({
    id: z.string(),
    activity: z.enum(['idle', 'working', 'waiting']),
    status: AgentStatus,
    health: z.nullable(AgentHealth),
    threads: z.array(z.object({ id: z.string(), agent: AgentState, typing: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })) })),
    subagents: z.array(Subagent),
  })) }),
])
export const LiveSnapshot = z.object({ turnId: z.nullable(z.string()), seq: z.number(), text: z.string(), agent: AgentState })
export type ThreadEvent = z.infer<typeof ThreadEvent>
export type LiveSnapshot = z.infer<typeof LiveSnapshot>

type Stream = { turnId: string; seq: number; text: string; early: Map<number, string> }
export type ThreadLive = { people: LivePerson[]; agent: AgentLive; stream?: Stream }
type Wire = { send: (message: object) => void; fetchLive: (thread: string) => Promise<LiveSnapshot>; refetch: (thread: string) => Promise<unknown> }

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

function drain(stream: Stream): Stream {
  let { seq, text } = stream
  const early = new Map(stream.early)
  for (let next = early.get(seq + 1); next !== undefined; next = early.get(seq + 1)) {
    early.delete(seq + 1)
    text += next
    seq += 1
  }
  for (const key of early.keys()) if (key <= seq) early.delete(key)
  return { ...stream, seq, text, early }
}

export const liveThreads = {
  connect(next: Wire) {
    wire = next
  },
  opened() {
    for (const thread of joined.keys()) {
      wire?.send({ type: 'join', thread })
      void liveThreads.catchUp(thread)
    }
  },
  receive(event: ThreadEvent) {
    if (event.type === 'agents') {
      agents = new Map(event.agents.map((agent) => [agent.id, agent]))
      boardThreads = new Map(event.agents.flatMap((agent) => agent.threads.map((thread) => [thread.id, thread])))
      return notify()
    }
    const { thread } = event
    if (event.type === 'presence') return put(thread, (live) => ({ ...live, people: event.people, agent: event.agent }))
    if (event.type === 'turn' && event.state === 'started') return put(thread, (live) => live.stream?.turnId === event.turnId ? live : { ...live, stream: { turnId: event.turnId, seq: 0, text: '', early: new Map() } })
    if (event.type === 'turn') return void liveThreads.finish({ thread, turnId: event.turnId })
    put(thread, (live) => {
      const stream = live.stream?.turnId === event.turnId ? live.stream : { turnId: event.turnId, seq: event.seq === 1 ? 0 : -1, text: '', early: new Map<number, string>() }
      if (stream.seq >= 0 && event.seq <= stream.seq) return live
      return { ...live, stream: drain({ ...stream, early: new Map(stream.early).set(event.seq, event.text) }) }
    })
  },
  async catchUp(thread: string) {
    const snapshot = await wire?.fetchLive(thread).catch(() => undefined)
    if (!snapshot) return
    put(thread, (live) => {
      const base = { ...live, agent: snapshot.agent }
      if (!snapshot.turnId) return { ...base, stream: undefined }
      const early = live.stream?.turnId === snapshot.turnId ? live.stream.early : new Map<number, string>()
      if (live.stream?.turnId === snapshot.turnId && live.stream.seq >= snapshot.seq) return base
      return { ...base, stream: drain({ turnId: snapshot.turnId, seq: snapshot.seq, text: snapshot.text, early }) }
    })
  },
  async finish({ thread, turnId }: { thread: string; turnId: string }) {
    await wire?.refetch(thread).catch(() => undefined)
    put(thread, (live) => live.stream?.turnId === turnId ? { ...live, stream: undefined } : live)
  },
  join(thread: string) {
    const count = joined.get(thread) ?? 0
    joined.set(thread, count + 1)
    if (count) return
    wire?.send({ type: 'join', thread })
    void liveThreads.catchUp(thread)
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

function useLive(thread: string): ThreadLive {
  return useSyncExternalStore(liveThreads.subscribe, () => liveThreads.get(thread))
}

export function useThreadLive(thread: string): { streaming?: { turnId: string; text: string }; agent: AgentLive } {
  useEffect(() => {
    liveThreads.join(thread)
    return () => liveThreads.leave(thread)
  }, [thread])
  const live = useLive(thread)
  return { streaming: live.stream && live.stream.seq >= 0 ? { turnId: live.stream.turnId, text: live.stream.text } : undefined, agent: live.agent }
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
