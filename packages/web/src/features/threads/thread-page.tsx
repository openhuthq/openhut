import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { ChatCall, ToolProgress, type ChatMessage, type ThreadWithMessages } from '@openhut/common/threads/thread.ts'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Creature } from '@/components/creature'
import { ErrorNote } from '@/components/error-note'
import { ICONS, STEP_ICONS } from '@/components/icons'
import { ButtonLabel, Page } from '@/components/page'
import { AgentBadge, agentState } from '@/components/status-badge'
import { useAgent, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { threadPath, useAgentThread, useClearChat } from '@/features/threads/api'
import { attachCalls, kindOf, stepsOf, type Step } from '@/features/threads/steps'
import { ConfirmDialog } from '@/components/confirm-button'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[] }>
type AgentPart = AgentMessage['parts'][number]


export function AgentChatPage({ me, agentId }: { me: Me; agentId: string }) {
  const agent = useAgent(agentId)
  const thread = useAgentThread(agentId)
  if (!agent.data || !thread.data) return <Page title={agent.data?.name ?? 'Chat'}><ErrorNote message={agent.error?.message ?? thread.error?.message} /></Page>
  return <ThreadView key={thread.data.id} me={me} thread={thread.data} agent={agent.data} />
}

function ThreadView({ me, thread, agent }: { me: Me; thread: ThreadWithMessages; agent: Agent }) {
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: `${threadPath(thread.id)}/chat`,
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
  }), [thread.id])
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport })
  const busy = chat.status === 'submitted' || chat.status === 'streaming'
  const send = (text: string) => void chat.sendMessage({ text })
  const last = chat.messages.at(-1)
  const menu = <ChatMenu agent={agent} threadId={thread.id} canClear={!busy && chat.messages.length > 0} />
  return <ChatLayout me={me} agent={agent} busy={busy} onSend={send} onStop={() => void chat.stop()} extra={menu}>
    {chat.messages.length ? chat.messages.map((message) => <Message key={message.id} agent={agent} message={message} live={busy && message === last} />) : <ChatEmpty agent={agent} onTry={send} />}
    {chat.status === 'submitted' && last?.role === 'user' && <Message agent={agent} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
    {chat.error && <Alert variant="error-outline" role="alert"><span>{chat.error.message}</span><Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => void chat.regenerate()}>Retry</Button></Alert>}
  </ChatLayout>
}

function ChatLayout({ me, agent, busy, onSend, onStop, extra, children }: { me: Me; agent: Agent; busy: boolean; extra?: ReactNode; onSend: (text: string) => void; onStop: () => void; children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  const browser = agent.browser && agent.canEdit && <a className={buttonVariants()} href={`/agents/${agent.id}/browser`} target="_blank" rel="noopener">{ICONS.ext}<ButtonLabel>Browser</ButtonLabel></a>
  const actions = <><AgentBadge agent={agent} />{browser}<a className={buttonVariants()} href={`/agents/${agent.id}`}>{ICONS.gear}<ButtonLabel>Settings</ButtonLabel></a>{extra}</>
  return <Page title={agent.name} actions={actions} fill>
    <div className="flex flex-1 flex-col overflow-auto px-6 py-5" ref={log} aria-live="polite" onScroll={(event) => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      <div className="mx-auto mt-auto mb-0 flex w-full max-w-[720px] flex-col gap-2.5">{children}</div>
    </div>
    <Composer me={me} agent={agent} busy={busy} onSend={onSend} onStop={onStop} />
  </Page>
}

function Composer({ me, agent, busy, onSend, onStop }: { me: Me; agent: Agent; busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const ready = agentState(agent) === 'running'
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const box = event.currentTarget.elements.namedItem('text')
    if (busy) return onStop()
    if (!(box instanceof HTMLTextAreaElement) || !box.value.trim()) return
    onSend(box.value.trim())
    box.value = ''
    box.style.height = ''
  }
  const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  return <div className="shrink-0 px-6 pb-3">
    {!ready && !busy && <NotReady agent={agent} />}
    <form className="mx-auto flex max-w-[760px] items-end gap-2 rounded-[14px] border border-mid bg-card py-1.5 pr-1.5 pl-3.5 shadow-[0_1px_2px_oklch(0%_0_0/.04),0_8px_24px_-12px_oklch(0%_0_0/.12)] [transition:border-color_.15s,box-shadow_.15s] focus-within:border-ink focus-within:shadow-[0_0_0_3px_oklch(0%_0_0/.06),0_8px_24px_-12px_oklch(0%_0_0/.16)]" onSubmit={submit}>
      <Textarea variant="composer" name="text" rows={1} aria-label="Message" placeholder={ready ? `Message ${agent.name}…` : `${agent.name} isn't ready yet`} disabled={!ready} autoFocus
        onKeyDown={enter} onInput={(event) => { const box = event.currentTarget; box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
      <div className="flex items-center justify-end gap-2.5">
        <Button type="submit" variant="send" aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && !ready}>{busy ? <span className="size-2.5 rounded-[2px] bg-white" /> : ICONS.up}</Button>
      </div>
    </form>
    <div className="mt-1.5 text-center font-copy text-[11px] text-mute-2">Enter to send, Shift+Enter for a new line</div>
  </div>
}

function NotReady({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const reason = {
    starting: 'Hermes is still starting. You can type as soon as it answers.',
    no_seat: agent.healthDetail,
    not_answering: agent.healthDetail || 'Hermes isn\'t answering.',
    stopped: 'It\'s stopped. Start it from Settings.',
    missing: 'Its container is gone. It is recreated within 30 seconds while it should be running.',
    running: '',
  }[state]
  const action = state === 'no_seat' ? <a href="/admin/seat">Connect the seat</a> : state !== 'starting' && <a href={`/agents/${agent.id}`}>Settings</a>
  return <Alert variant="warning" role="status"><b>{agent.name} isn't ready.</b> {reason} {action}</Alert>
}

function Message({ agent, message, live }: { agent: Agent; message: AgentMessage; live: boolean }) {
  if (message.role === 'user') return <div className={cn(MESSAGE, 'flex justify-end')}><div className="max-w-[78%] rounded-[16px_16px_4px_16px] bg-sidebar px-3.5 py-2 text-sm/[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap">{textOf(message)}</div></div>
  const blocks = blocksOf(message)
  return <div className={cn(MESSAGE, 'grid grid-cols-[28px_minmax(0,1fr)] gap-3')}>
    <span className={live ? 'talking' : undefined}><Creature id={agent.id} about={agent.instructions} size={28} /></span>
    <div className="flex min-w-0 flex-col gap-2 pt-[3px]">
      {blocks.map((block, index) => block.type === 'text'
        ? <div key={index} className="msg-t"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ChatLink }}>{block.text}</Markdown></div>
        : <Steps key={index} steps={block.steps} live={live && index === blocks.length - 1} />)}
      {live && !blocks.length && <span className="inline-flex gap-[3px] py-2" aria-label={`${agent.name} is thinking`}>{[0, 1, 2].map((dot) => <i key={dot} className={cn('size-[5px] animate-[blinkdot_1s_infinite] rounded-full bg-mute-2', DOT_DELAY[dot])} />)}</span>}
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
  const summary = steps.length === 1 ? steps[0].title : `${steps.length} tools`
  return <Collapsible className="text-[13px] text-mute">
    <CollapsibleTrigger className="group/steps -ml-1 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-[3px] pr-2 pl-1 text-left text-inherit hover:bg-tint hover:text-ink">
      <span className="flex shrink-0 gap-[3px]">{steps.slice(-6).map((step) => <StepTile key={step.key} step={step} running={step === running} />)}</span>
      {running ? <span className="animate-[shimmer_1.4s_linear_infinite] bg-[linear-gradient(90deg,var(--mute)_30%,var(--ink)_50%,var(--mute)_70%)] bg-size-[200%_100%] bg-clip-text whitespace-nowrap text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-mute">Running <span className="font-mono text-xs">{running.title}</span>…</span> : <span className="truncate">Used {steps.length === 1 ? <span className="font-mono text-xs">{summary}</span> : summary}</span>}
      {blocked > 0 && <Badge variant="destructive">{blocked} blocked</Badge>}
      <span className="grid shrink-0 text-mute-2 [transition:transform_.15s] group-data-panel-open/steps:rotate-90">{ICONS.chev}</span>
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
const MESSAGE = 'animate-[msgin_.3s_cubic-bezier(.2,.8,.2,1)] py-1.5'
const DOT_DELAY = ['', '[animation-delay:.15s]', '[animation-delay:.3s]']
const TILE = {
  code: '[--k:oklch(50%_.14_265)]',
  web: '[--k:oklch(54%_.12_233)]',
  find: '[--k:oklch(52%_.1_200)]',
  app: '[--k:oklch(52%_.13_163)]',
  file: '[--k:oklch(55%_.13_70)]',
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

function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const bare = href !== undefined && children === href && /^https?:\/\//.test(href)
  return <a href={href} target="_blank" rel="noreferrer">{bare ? shortUrl(href) : children}{bare && <span className="ml-[3px] text-[11px] text-mute">↗</span>}</a>
}

function shortUrl(href: string) {
  const short = href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return short.length > 40 ? `${short.slice(0, 38)}…` : short
}

function ChatMenu({ agent, threadId, canClear }: { agent: Agent; threadId: string; canClear: boolean }) {
  const clearChat = useClearChat(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const [confirming, setConfirming] = useState<'clear' | 'delete' | null>(null)
  const confirm = (kind: 'clear' | 'delete') => (open: boolean) => setConfirming(open ? kind : null)
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ size: 'icon' })} aria-label="More actions" title="More">{ICONS.more}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!canClear || clearChat.isPending} onClick={() => setConfirming('clear')}>{ICONS.eraser}Clear chat</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!agent.canEdit || deleteAgent.isPending} onClick={() => setConfirming('delete')}>{ICONS.trash}Delete agent</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog open={confirming === 'clear'} onOpenChange={confirm('clear')} question="Clear this chat?" detail={`${agent.name} starts a fresh conversation. It keeps what it saved to memory.`} action="Clear" onConfirm={() => clearChat.mutate(threadId, { onError: toastError })} />
    <ConfirmDialog open={confirming === 'delete'} onOpenChange={confirm('delete')} question={`Delete ${agent.name}?`} detail="This can't be undone." action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })} />
  </>
}

function ChatEmpty({ agent, onTry }: { agent: Agent; onTry: (text: string) => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const start = <Button type="button" variant="primary" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: 'running' }, { onError: toastError })}>{ICONS.play}Start {agent.name}</Button>
  const state = agentState(agent)
  const copy = {
    running: [`Ask ${agent.name} anything`, ''],
    starting: [`Starting ${agent.name}`, 'Hermes takes about a minute to start. You can type as soon as it answers.'],
    no_seat: [`${agent.name} isn't ready`, agent.healthDetail],
    not_answering: [`${agent.name} isn't answering`, agent.healthDetail || 'The container is running, but Hermes isn\'t answering.'],
    stopped: [`${agent.name} is stopped`, 'Start it to chat with it.'],
    missing: [`${agent.name} has an error`, 'Its container is gone. It is recreated within 30 seconds while it should be running.'],
  }[state]
  return <div className="m-auto flex max-w-[400px] flex-col items-center gap-2.5 py-8 text-center">
    <Creature id={agent.id} about={agent.instructions} size={72} />
    <h3 className="mt-1.5 mb-0 bg-(image:--squiggle) bg-size-[auto_7px] bg-bottom-left bg-repeat-x pb-2.5 font-display text-[32px]/none font-normal tracking-[.01em] uppercase">{copy[0]}</h3>
    {copy[1] && <p className="m-0 font-copy text-sm/[1.5] text-body">{copy[1]}</p>}
    {state === 'stopped' && start}
    {agent.wanted === 'stopped' && state === 'missing' && start}
    {state === 'not_answering' && <a className={buttonVariants({ variant: 'primary' })} href={`/agents/${agent.id}`}>Settings</a>}
    {state === 'no_seat' && <a className={buttonVariants({ variant: 'primary' })} href="/admin/seat">Connect the Claude seat</a>}
  </div>
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
