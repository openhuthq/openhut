import type { ReactNode } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dots } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { Face } from '@/features/agents/face'
import { useOwner } from '@/features/people/api'
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

export function busyAgent(agent: AgentLive): boolean {
  return agent.state !== 'idle'
}

function Bubble() {
  return <span className="absolute -top-2 left-1/2 flex h-[9px] -translate-x-1/2 items-center gap-[2px] rounded-full bg-ink px-[3px]" aria-hidden="true">
    {['', '[animation-delay:.16s]', '[animation-delay:.32s]'].map((delay) => <i key={delay} className={cn('size-[3px] animate-pulse rounded-full bg-white', delay)} />)}
  </span>
}

export function PresenceFaces({ agent, threadId }: { agent: Agent; threadId: string }) {
  const { people, agent: live } = usePresence(threadId)
  const me = useOwner()
  if (!people.some((person) => person.email !== me)) return null
  return <><Popover>
    <PopoverTrigger render={<Button type="button" variant="bare" className="flex h-8 items-center gap-2 rounded-lg px-1.5 text-[13px] font-normal text-body hover:bg-hover" aria-label={`${people.length} here`} />}>
      <span className="flex items-center">
        {people.map((person) => <span key={person.id} className="relative -ml-1.5 first:ml-0" title={nameOf(person)}>
          <PersonFace name={nameOf(person)} email={person.email} size={24} />
          <i className="absolute -right-px -bottom-px size-2 rounded-full border-[1.5px] border-card bg-pass" />
          {person.state === 'typing' && <Bubble />}
        </span>)}
      </span>
      {people.length} here
    </PopoverTrigger>
    <PopoverContent className="w-[280px] gap-0 p-2">
      <p className="m-0 px-2 pt-1 pb-1.5 text-[12px] text-mute">In this thread</p>
      <Row face={<Face agent={agent} size={24} />} name={agent.name} state={AGENT_WORD[live.state]} tone={live.state === 'replying' ? 'text-success-foreground' : undefined} />
      {people.map((person) => <Row key={person.id} face={<PersonFace name={nameOf(person)} email={person.email} size={24} />} name={nameOf(person)} you={person.email === me} state={PERSON_WORD[person.state]} />)}
    </PopoverContent>
  </Popover><span className="mx-1.5 h-4 w-px bg-hair phone:hidden" /></>
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
  return <div className="flex items-center gap-2 text-[12.5px] text-mute" role="status">
    <span className="flex items-center">{typing.slice(0, 3).map((person) => <span key={person.id} className="-ml-1 first:ml-0"><PersonFace name={nameOf(person)} email={person.email} size={16} /></span>)}</span>
    <span><span className="text-body">{typingLine(typing.map((person) => nameOf(person)))}</span></span>
    <span className="opacity-50"><Dots /></span>
  </div>
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
