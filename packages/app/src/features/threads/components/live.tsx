import { useEffect, useState, type ReactNode } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Dots } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { Face } from '@/components/agent-face'
import { useOwner } from '@/lib/queries/people'
import { namesLine, typingLine, usePresence, type AgentLive, type LivePerson } from '@/lib/thread-live'
import { personName } from '@/lib/format'
import { cn } from '@/lib/utils'

function nameOf(person: Pick<LivePerson, 'name' | 'email'>): string {
  return person.name && !person.name.includes('@') ? person.name : personName(person.email)
}

function answeringLine({ answering, people }: { answering: string[]; people: LivePerson[] }): string {
  return namesLine(answering.map((who) => {
    const person = people.find((each) => each.email === who)
    if (person) return nameOf(person)
    return who.includes('@') ? personName(who) : who
  }))
}

const AGENT_WORD: Record<AgentLive['state'], string> = { idle: 'Idle', thinking: 'Working', working: 'Working', replying: 'Replying' }
const PERSON_WORD: Record<LivePerson['state'], string> = { viewing: 'Viewing', typing: 'Typing' }

export function PresenceFaces({ agent, threadId }: { agent: Agent; threadId: string }) {
  const { people, agent: live } = usePresence(threadId)
  const me = useOwner()
  const others = people.filter((person) => person.email !== me)
  if (!others.length) return null
  const extra = others.length - 3
  return <Popover>
    <PopoverTrigger render={<Button type="button" variant="bare" className="flex h-8 items-center gap-1 rounded-full transition-opacity hover:opacity-75" aria-label={`Here: ${namesLine(others.map(nameOf))}`} title={namesLine(others.map(nameOf))} />}>
      {others.slice(0, extra > 0 ? 2 : 3).map((person) => <PersonFace key={person.id} name={nameOf(person)} email={person.email} size={28} />)}
      {extra > 0 && <span className="grid size-7 place-items-center rounded-full bg-soft text-[11px] font-semibold text-body">+{extra + 1}</span>}
    </PopoverTrigger>
    <PopoverContent className="w-[280px] gap-0 p-2">
      <p className="m-0 px-2 pt-1 pb-1.5 text-[12px] text-mute">In this thread</p>
      <Row face={<Face agent={agent} size={24} />} name={agent.name} state={AGENT_WORD[live.state]} tone={live.state === 'replying' ? 'text-success-foreground' : undefined} />
      {people.map((person) => <Row key={person.id} face={<PersonFace name={nameOf(person)} email={person.email} size={24} />} name={nameOf(person)} you={person.email === me} state={PERSON_WORD[person.state]} />)}
    </PopoverContent>
  </Popover>
}

function Row({ face, name, you, state, tone }: { face: ReactNode; name: string; you?: boolean; state: string; tone?: string }) {
  return <div className="flex h-9 items-center gap-2.5 px-2 text-[13px]">
    {face}
    <span className="min-w-0 flex-1 truncate text-ink">{name}{you && <span className="text-mute"> (you)</span>}</span>
    <span className={cn('shrink-0 text-mute', tone)}>{state}</span>
  </div>
}

export function TypingNow({ threadId }: { threadId: string }) {
  const me = useOwner()
  const typing = usePresence(threadId).typing.filter((person) => person.email !== me)
  if (!typing.length) return null
  return <p role="status" className="absolute bottom-full left-4 m-0 mb-2 flex items-center gap-1.5 text-[12.5px] text-mute">
    <span className="flex items-center gap-0.5">{typing.slice(0, 3).map((person) => <PersonFace key={person.id} name={nameOf(person)} email={person.email} size={18} />)}</span>
    {typingLine(typing.map((person) => nameOf(person).split(' ')[0]))}…
  </p>
}

export function SeenBy({ threadId }: { threadId: string }) {
  const me = useOwner()
  const others = usePresence(threadId).people.filter((person) => person.email !== me)
  if (!others.length) return null
  return <span className="inline-flex items-center gap-1.5 text-[12px] text-mute" title={namesLine(others.map((person) => nameOf(person)))}>
    Seen by<span className="flex items-center">{others.map((person) => <span key={person.id} className="-ml-1 first:ml-0"><PersonFace name={nameOf(person)} email={person.email} size={14} /></span>)}</span>
  </span>
}

export function LiveTitle({ threadId }: { threadId: string }) {
  const { people, agent } = usePresence(threadId)
  const answering = agent.answering ?? []
  return <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
    {answering.length > 0 && <span className="truncate text-body">Answering {answeringLine({ answering, people })}</span>}
    {people.length > 1 && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11.5px] text-success-foreground"><i className="size-1.5 rounded-full bg-pass" />Live · {people.length} watching</span>}
  </span>
}

export function useLiveLine(threadId: string): ReactNode {
  const me = useOwner()
  const { people, typing, agent } = usePresence(threadId)
  const others = typing.filter((person) => person.email !== me)
  if (agent.state === 'replying') return <span className="min-w-0 truncate text-success-foreground">{agent.answering?.length ? `Answering ${answeringLine({ answering: agent.answering, people })}` : 'Answering…'}</span>
  if (others.length) return <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{typingLine(others.map((person) => nameOf(person)))}</span><span className="shrink-0 opacity-60"><Dots /></span></span>
  return null
}

const STARTED = new Map<string, number>()
const STATE_WORD: Record<AgentLive['state'], string> = { idle: 'Working', thinking: 'Thinking', working: 'Working', replying: 'Writing' }

export function WorkStatus({ threadId }: { threadId: string }) {
  const { agent } = usePresence(threadId)
  const key = agent.turnId ?? threadId
  if (!STARTED.has(key)) STARTED.set(key, Date.now())
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - (STARTED.get(key) ?? now)) / 1000))
  return <span className="flex min-w-0 items-center gap-2 pt-1 text-[13px] text-mute" role="status">
    <Spinner className="mt-0 size-3.5 shrink-0" />
    <span className="truncate text-body">{agent.step ?? STATE_WORD[agent.state]}…</span>
    <span className="shrink-0 tabular-nums">{elapsed(seconds)}</span>
  </span>
}

function elapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
