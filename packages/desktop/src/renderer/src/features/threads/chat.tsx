import { useContext, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp02Icon, EraserIcon, PlayIcon, PlusSignIcon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@openhut/client'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChatCall, ToolProgress, type ChatMessage, type ThreadWithMessages } from '@openhut/common/threads/thread.ts'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { STEP_ICONS } from '@/components/icons'
import { DRAG, Dots, I, ICON_BUTTON } from '@/components/kit'
import { SidebarContext } from '@/features/agents/sidebar'
import { agentState } from '@/components/status-badge'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { threadPath, useAgentThread, useClearChat, useTouchThread } from '@/features/threads/api'
import { ConfirmIcon } from '@/components/confirm-button'
import { attachCalls, kindOf, stepsOf, type Step } from '@/features/threads/steps'
import { on } from '@/lib/openhut'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[] }>
type AgentPart = AgentMessage['parts'][number]

export function Chat({ agent, tools }: { agent: Agent; tools?: ReactNode }) {
  const thread = useAgentThread(agent.id)
  if (agentState(agent) === 'stopped') return <ChatFrame agent={agent} tools={tools}><Asleep agent={agent} /></ChatFrame>
  if (!thread.data) return <ChatFrame agent={agent} tools={tools}><div className="m-auto"><ErrorNote message={thread.error?.message} /></div></ChatFrame>
  return <ThreadView key={thread.data.id} thread={thread.data} agent={agent} tools={tools} />
}

function ThreadView({ thread, agent, tools }: { thread: ThreadWithMessages; agent: Agent; tools: ReactNode }) {
  const touch = useTouchThread()
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: on({ agentId: agent.id, path: `${threadPath(thread.id)}/chat` }),
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
  }), [thread.id, agent.id])
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport, onFinish: () => touch(thread) })
  const busy = chat.status === 'submitted' || chat.status === 'streaming'
  const send = (text: string) => { touch(thread); void chat.sendMessage({ text }) }
  const last = chat.messages.at(-1)
  const clear = chat.messages.length > 0 && !busy && <ClearChat agent={agent} threadId={thread.id} />
  return <ChatFrame agent={agent} tools={<>{clear}{tools}</>} composer={<Composer agent={agent} busy={busy} quiet={!chat.messages.length} onSend={send} onStop={() => void chat.stop()} />}>
    {chat.messages.length ? <>
      <Day iso={thread.updatedAt} />
      {chat.messages.map((message) => <Message key={message.id} agent={agent} message={message} live={busy && message === last} />)}
    </> : <ChatEmpty agent={agent} />}
    {chat.status === 'submitted' && last?.role === 'user' && <Message agent={agent} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
    {chat.error && <Alert variant="error-outline" role="alert"><span>{chat.error.message}</span><Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => void chat.regenerate()}>Retry</Button></Alert>}
  </ChatFrame>
}

function ChatFrame({ agent, composer, tools, children }: { agent: Agent; composer?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null)
  const sidebar = useContext(SidebarContext)
  const pinned = useRef(true)
  useEffect(() => {
    const element = log.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  })
  return <section className="flex min-w-0 flex-1 flex-col bg-card">
    <title>{`${agent.name} · OpenHut`}</title>
    <div className={cn('flex h-[52px] shrink-0 items-center gap-2 px-4', sidebar?.collapsed && 'pl-[84px]', DRAG)}>
      {sidebar?.collapsed && <span className="mr-2 flex animate-[fadein_120ms_80ms_ease-out_backwards] items-center gap-0.5">
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Show sidebar" title="Show sidebar ⌘\" onClick={sidebar.expand}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="New agent" title="New agent" onClick={sidebar.newAgent}><I icon={PlusSignIcon} size={16} /></Button>
      </span>}
      <Face agent={agent} size={26} /><span className="text-[14px] font-semibold">{agent.name}</span>
      <span className="ml-auto flex items-center gap-0.5">{tools}</span>
    </div>
    <div ref={log} className="fade-t flex flex-1 flex-col overflow-auto px-8 py-5" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-end gap-4">{children}</div>
    </div>
    {composer}
  </section>
}

function Day({ iso }: { iso: string }) {
  const date = new Date(iso)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })
  return <div className="flex items-center gap-3 text-[11.5px] text-mute-2"><span className="h-px flex-1 bg-hair" />{label}<span className="h-px flex-1 bg-hair" /></div>
}

function Composer({ agent, busy, quiet, onSend, onStop }: { agent: Agent; busy: boolean; quiet: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [empty, setEmpty] = useState(true)
  const ready = agentState(agent) === 'running'
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const box = event.currentTarget.elements.namedItem('text')
    if (busy) return onStop()
    if (!(box instanceof HTMLTextAreaElement) || !box.value.trim()) return
    onSend(box.value.trim())
    box.value = ''
    box.style.height = ''
    setEmpty(true)
  }
  const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  return <div className="shrink-0 px-8 pb-5">
    {!ready && !busy && !quiet && <NotReady agent={agent} />}
    <form className="mx-auto flex max-w-[640px] items-end gap-2 rounded-xl border border-[oklch(0%_0_0/.12)] bg-card py-2 pr-2 pl-3.5 focus-within:border-mid" onSubmit={submit}>
      <Textarea variant="composer" name="text" rows={1} aria-label="Message" placeholder={placeholderOf(agent)} disabled={!ready} autoFocus
        className="min-h-0 flex-1 py-1.5 text-[14px]" onKeyDown={enter}
        onInput={(event) => { const box = event.currentTarget; setEmpty(!box.value.trim()); box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
      <Button type="submit" variant="send" className={cn(!busy && empty && 'bg-transparent text-mute disabled:opacity-100')} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && (!ready || empty)}>{busy ? <span className="size-2.5 rounded-[2px] bg-white" /> : <I icon={ArrowUp02Icon} />}</Button>
    </form>
  </div>
}

function placeholderOf(agent: Agent) {
  const state = agentState(agent)
  if (state === 'running' || state === 'not_answering') return `Ask ${agent.name} anything…`
  if (state === 'stopped') return `${agent.name} is asleep`
  return `${agent.name} isn't ready yet`
}

function NotReady({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const reason = {
    starting: 'It\'s still starting. You can type as soon as it answers.',
    no_seat: 'It needs a Claude sign-in.',
    not_answering: 'It restarts on its own, or Stop and Start it from the panel.',
    stopped: '',
    missing: 'It comes back by itself within 30 seconds.',
    running: '',
  }[state]
  return <Alert variant="warning" className="max-w-[640px]" role="status" title={agent.healthDetail || undefined}><b>{agent.name} isn't ready.</b> {reason} {state === 'no_seat' && <a href="/settings/models">Sign in to Claude</a>}</Alert>
}

function ClearChat({ agent, threadId }: { agent: Agent; threadId: string }) {
  const clearChat = useClearChat(agent.id)
  return <ConfirmIcon label="Clear chat" icon={EraserIcon} question="Clear this chat? Memory stays." action="Clear" busy={clearChat.isPending}
    onConfirm={(done) => clearChat.mutate(threadId, { onSuccess: done, onError: toastError })} />
}

function useOffline(agent: Agent) {
  const home: OpenHutAgent | undefined = useAgents().data?.find((each) => each.id === agent.id)
  return home && !home.online
}

function Message({ agent, message, live }: { agent: Agent; message: AgentMessage; live: boolean }) {
  if (message.role === 'user') return <div className="flex animate-grow justify-end"><div className="max-w-[78%] rounded-[12px_12px_4px_12px] bg-soft px-3.5 py-2 text-[14px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink">{textOf(message)}</div></div>
  const blocks = blocksOf(message)
  return <div className="grid animate-grow grid-cols-[34px_minmax(0,1fr)] gap-3">
    <span className={live ? 'talking' : undefined}><Face agent={agent} size={34} /></span>
    <div className="flex min-w-0 flex-col gap-2 pt-1.5">
      {blocks.map((block, index) => block.type === 'text'
        ? <div key={index} className="msg-t"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ChatLink }}>{block.text}</Markdown></div>
        : <Steps key={index} steps={block.steps} live={live && index === blocks.length - 1} />)}
      {live && !blocks.length && <span className="pt-1.5" aria-label={`${agent.name} is thinking`}><Dots /></span>}
      {!live && !blocks.length && <span className="text-[13.5px] text-mute-2 italic">No reply.</span>}
    </div>
  </div>
}

type Block = { type: 'text'; text: string } | { type: 'steps'; steps: Step[] }

function blocksOf(message: AgentMessage): Block[] {
  const blocks: Block[] = []
  let events: ToolProgress[] = []
  const flush = () => {
    if (events.length) blocks.push({ type: 'steps', steps: stepsOf(events) })
    events = []
  }
  for (const part of message.parts) {
    if (part.type === 'data-tool') events.push(part.data)
    if (part.type === 'text' && part.text) {
      flush()
      blocks.push({ type: 'text', text: part.text })
    }
  }
  flush()
  const steps = blocks.flatMap((block) => block.type === 'steps' ? block.steps : [])
  const calls = message.parts.flatMap((part) => part.type === 'data-calls' ? part.data : [])
  const left = attachCalls({ steps, calls }).map((call, index): Step => ({ key: `call${index}`, tool: call.tool, title: call.tool, count: 1, done: true, call }))
  if (left.length) blocks.push({ type: 'steps', steps: left })
  return blocks
}

function Steps({ steps, live }: { steps: Step[]; live: boolean }) {
  const running = live ? steps.filter((step) => !step.done).at(-1) : undefined
  const blocked = steps.filter(failed).length
  const connection = steps.find((step) => step.call?.connectionName)?.call?.connectionName
  const summary = steps.length === 1 ? <span className="font-mono text-[11.5px] text-ink">{steps[0].title}</span> : `${steps.length} tools`
  return <Collapsible className="text-[12.5px] text-mute">
    <CollapsibleTrigger className="group/steps -ml-1 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-[3px] pr-2 pl-1 text-left text-inherit hover:bg-tint">
      <span className="flex shrink-0 gap-[3px]">{steps.slice(-6).map((step) => <StepTile key={step.key} step={step} running={step === running} />)}</span>
      {running
        ? <span className="animate-[shimmer_1.4s_linear_infinite] bg-[linear-gradient(90deg,var(--mute)_30%,var(--ink)_50%,var(--mute)_70%)] bg-size-[200%_100%] bg-clip-text whitespace-nowrap text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-mute">Running <span className="font-mono text-[11.5px]">{running.title}</span>…</span>
        : <span className="truncate">Used {summary}{connection && <> on <span className="text-ink">{connection}</span></>}</span>}
      {blocked > 0 && <Badge variant="destructive">{blocked} blocked</Badge>}
      <span className="text-mute-2 [transition:transform_.15s] group-data-panel-open/steps:rotate-90">›</span>
    </CollapsibleTrigger>
    <CollapsibleContent><ul className="mt-1.5 mr-0 mb-0.5 ml-3.5 flex list-none flex-col gap-2 border-l-[1.5px] border-hair py-0.5 pr-0 pl-3.5">{steps.map((step) => <li className="flex min-w-0 flex-col gap-1.5" key={step.key}>
      <div className="flex min-w-0 items-center gap-2">
        <StepTile step={step} running={step === running} />
        <span className="font-mono text-xs text-ink">{step.title}</span>
        {step.count > 1 && <span className="font-mono text-xs text-mute">×{step.count}</span>}
        {step.call?.connectionName && <span className="truncate text-mute">{step.call.connectionName}</span>}
        {step.call && <Badge variant={failed(step) ? 'destructive' : 'success'} title={step.call.reason}>{OUTCOME[step.call.outcome]}</Badge>}
        {step.call && <span className="ml-auto font-mono text-xs text-mute">{step.call.ms} ms</span>}
      </div>
      {step.call && failed(step) && <p className="m-0 text-[12.5px] text-body">{step.call.reason}</p>}
      {step.detail && <pre className="m-0 max-h-[9.5em] overflow-auto rounded-lg bg-sidebar px-2.5 py-2 font-mono text-[11.5px]/[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap text-body">{step.detail}</pre>}
    </li>)}</ul></CollapsibleContent>
  </Collapsible>
}

const OUTCOME = { allowed: 'Allowed', denied: 'Denied', failed: 'Failed' }
const TILE = {
  code: '[--k:#8a6ae0]',
  web: '[--k:oklch(54%_.12_233)]',
  find: '[--k:oklch(52%_.1_200)]',
  app: '[--k:#3d8fdc]',
  file: '[--k:#8a6ae0]',
  memory: '[--k:oklch(52%_.16_305)]',
  bad: '[--k:var(--fail)]',
  other: '[--k:var(--mute)]',
}

function StepTile({ step, running }: { step: Step; running: boolean }) {
  const kind = kindOf(step.call ? 'call_tool' : step.tool)
  const bad = failed(step)
  return <span className={cn('grid size-[22px] shrink-0 animate-[tilein_.26s_cubic-bezier(.22,1,.36,1)] place-items-center rounded-md bg-[color-mix(in_oklch,var(--k)_12%,transparent)] text-(--k) shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--k)_22%,transparent)]', TILE[bad ? 'bad' : kind], running && 'animate-[tilepulse_1.2s_ease-in-out_infinite]')} title={step.title}>{STEP_ICONS[bad ? 'blocked' : kind]}</span>
}

function failed(step: Step) {
  return step.call !== undefined && step.call.outcome !== 'allowed'
}

export function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const bare = href !== undefined && children === href && /^https?:\/\//.test(href)
  return <a href={href} target="_blank" rel="noreferrer">{bare ? shortUrl(href) : children}{bare && <span className="ml-[3px] text-[11px] text-mute">↗</span>}</a>
}

function shortUrl(href: string) {
  const short = href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return short.length > 40 ? `${short.slice(0, 38)}…` : short
}

function ChatEmpty({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const offline = useOffline(agent)
  const copy = offline
    ? [`${agent.name}'s computer is offline`, 'It answers again as soon as its computer is back on your tailnet.']
    : {
      running: [`Say hello to ${agent.name}`, 'Ask it anything, or tell it what its job is.'],
      starting: [`Starting ${agent.name}`, 'It takes about a minute the first time. You can type as soon as it answers.'],
      no_seat: [`${agent.name} isn't ready`, 'Sign in to Claude in Settings, then it starts answering.'],
      not_answering: [`${agent.name} isn't answering`, 'It restarts on its own, or Stop and Start it from the panel.'],
      stopped: ['', ''],
      missing: [`${agent.name} stopped unexpectedly`, 'It comes back by itself within 30 seconds.'],
    }[state]
  const detail = state === 'no_seat' || state === 'not_answering' ? agent.healthDetail : ''
  return <Centered agent={agent} title={copy[0]} line={copy[1]} pulse={state === 'starting'}>
    {state === 'no_seat' && <a href="/settings/models" className="text-ink underline underline-offset-2">Open Settings › Models</a>}
    {detail && <Details text={detail} />}
  </Centered>
}

function Asleep({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Centered agent={agent} title={`${agent.name} is asleep`} line="It won't answer here or on its channels until you start it. Its memory and chats are kept." dim>
    <Button type="button" variant="primary" className="mt-1 gap-1.5" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: 'running' }, { onError: toastError })}><I icon={PlayIcon} size={14} />Start {agent.name}</Button>
  </Centered>
}

function Centered({ agent, title, line, pulse, dim, children }: { agent: Agent; title: string; line: string; pulse?: boolean; dim?: boolean; children?: ReactNode }) {
  return <div className="m-auto flex max-w-[400px] flex-col items-center gap-2 py-8 text-center">
    <span className={cn(pulse && 'animate-pulse', dim && 'opacity-70 grayscale')}><Face agent={agent} size={64} /></span>
    <h3 className="mt-2 mb-0 text-[20px]/[1.3] font-semibold text-ink">{title}</h3>
    {line && <p className="m-0 text-[14px]/[1.5] text-balance text-body">{line}</p>}
    {children}
  </div>
}

function Details({ text }: { text: string }) {
  return <Collapsible className="flex flex-col items-center gap-1.5 text-[13px]">
    <CollapsibleTrigger className="group/details inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-mute hover:text-ink">Details<span className="[transition:transform_.15s] group-data-panel-open/details:rotate-90">›</span></CollapsibleTrigger>
    <CollapsibleContent><p className="m-0 max-w-[400px] rounded-lg bg-tint px-3 py-2 text-left font-mono text-[12px]/[1.5] [overflow-wrap:anywhere] text-body">{text}</p></CollapsibleContent>
  </Collapsible>
}

function uiMessageOf(message: ChatMessage): AgentMessage {
  return { id: message.id, role: message.role, parts: message.parts.flatMap((part): AgentPart[] => {
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (part.type === 'data-tool') return [{ type: 'data-tool', data: z.safeParse(ToolProgress, part.data).data ?? {} }]
    if (part.type === 'data-calls') return [{ type: 'data-calls', data: z.safeParse(z.array(ChatCall), part.data).data ?? [] }]
    return []
  }) }
}

function textOf(message: AgentMessage) {
  return message.parts.map((part) => part.type === 'text' ? part.text : '').join('')
}
