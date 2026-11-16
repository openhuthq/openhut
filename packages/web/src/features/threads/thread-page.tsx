import { useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { Menu } from '@base-ui/react/menu'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { ChatCall, ToolProgress, type ChatMessage, type ThreadWithMessages } from '@openhut/common/threads/thread.ts'
import { Avatar } from '@/components/avatar'
import { ErrorNote } from '@/components/error-note'
import { ICONS, STEP_ICONS } from '@/components/icons'
import { Page } from '@/components/page'
import { AgentBadge, agentState } from '@/components/status-badge'
import { useAgent, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { threadPath, useAgentThread, useClearChat } from '@/features/threads/api'
import { attachCalls, kindOf, stepsOf, type Step } from '@/features/threads/steps'
import { ConfirmDialog } from '@/components/confirm-button'
import { toastError } from '@/lib/toast'

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
    {chat.error && <div className="chat-err" role="alert"><span>{chat.error.message}</span><button type="button" className="btn sec sm" onClick={() => void chat.regenerate()}>Retry</button></div>}
  </ChatLayout>
}

function ChatLayout({ me, agent, busy, onSend, onStop, extra, children }: { me: Me; agent: Agent; busy: boolean; extra?: ReactNode; onSend: (text: string) => void; onStop: () => void; children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  const actions = <><AgentBadge agent={agent} /><a className="btn" href={`/agents/${agent.id}`}>{ICONS.gear}<span className="lbl">Settings</span></a>{extra}</>
  return <Page title={agent.name} actions={actions} fill>
    <div className="chat-log" ref={log} aria-live="polite" onScroll={(event) => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      <div className="chat-col">{children}</div>
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
  return <div className="chat-foot">
    {!ready && !busy && <NotReady agent={agent} />}
    <form className="composer" onSubmit={submit}>
      <textarea name="text" rows={1} aria-label="Message" placeholder={ready ? `Message ${agent.name}…` : `${agent.name} isn't ready yet`} disabled={!ready} autoFocus
        onKeyDown={enter} onInput={(event) => { const box = event.currentTarget; box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
      <div className="composer-bar">
        <button type="submit" className={busy ? 'send stop' : 'send'} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && !ready}>{busy ? <span className="sq" /> : ICONS.up}</button>
      </div>
    </form>
    <div className="chat-hint">Enter to send, Shift+Enter for a new line</div>
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
  return <div className="chat-notice" role="status"><b>{agent.name} isn't ready.</b> {reason} {action}</div>
}

function Message({ agent, message, live }: { agent: Agent; message: AgentMessage; live: boolean }) {
  if (message.role === 'user') return <div className="msg mine"><div className="bubble">{textOf(message)}</div></div>
  const blocks = blocksOf(message)
  return <div className="msg">
    <span className={live ? 'talking' : undefined}><Avatar id={agent.id} about={agent.instructions} size={28} /></span>
    <div className="msg-b">
      {blocks.map((block, index) => block.type === 'text'
        ? <div key={index} className="msg-t"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ChatLink }}>{block.text}</Markdown></div>
        : <Steps key={index} steps={block.steps} live={live && index === blocks.length - 1} />)}
      {live && !blocks.length && <span className="typing" aria-label={`${agent.name} is thinking`}><i /><i /><i /></span>}
      {!live && !blocks.length && <span className="noreply">No reply.</span>}
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
  return <details className="steps">
    <summary>
      <span className="tiles">{steps.slice(-6).map((step) => <StepTile key={step.key} step={step} running={step === running} />)}</span>
      {running ? <span className="shimmer">Running <span className="mono">{running.title}</span>…</span> : <span className="ellip">Used {steps.length === 1 ? <span className="mono">{summary}</span> : summary}</span>}
      {blocked > 0 && <span className="status destructive">{blocked} blocked</span>}
      <span className="chev">{ICONS.chev}</span>
    </summary>
    <ul>{steps.map((step) => <li key={step.key}>
      <div className="step-row">
        <StepTile step={step} running={step === running} />
        <span className="mono">{step.title}</span>
        {step.count > 1 && <span className="mono mute">×{step.count}</span>}
        {step.call?.connectionName && <span className="mute ellip">{step.call.connectionName}</span>}
        {step.call && <span className={`status ${failed(step) ? 'destructive' : 'success'}`} title={step.call.reason}>{OUTCOME[step.call.outcome]}</span>}
        {step.call && <span className="mono mute ms">{step.call.ms} ms</span>}
      </div>
      {step.call && failed(step) && <p className="step-why">{step.call.reason}</p>}
      {step.detail && <pre className="step-code">{step.detail}</pre>}
    </li>)}</ul>
  </details>
}

const OUTCOME = { allowed: 'Allowed', denied: 'Denied', failed: 'Failed' }

function StepTile({ step, running }: { step: Step; running: boolean }) {
  const kind = kindOf(step.call ? 'call_tool' : step.tool)
  const bad = failed(step)
  return <span className={`tile k-${bad ? 'bad' : kind}${running ? ' run' : ''}`} title={step.title}>{STEP_ICONS[bad ? 'blocked' : kind]}</span>
}

function failed(step: Step) {
  return step.call !== undefined && step.call.outcome !== 'allowed'
}

function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const bare = href !== undefined && children === href && /^https?:\/\//.test(href)
  return <a href={href} target="_blank" rel="noreferrer">{bare ? shortUrl(href) : children}{bare && <span className="ext">↗</span>}</a>
}

function shortUrl(href: string) {
  const short = href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return short.length > 40 ? `${short.slice(0, 38)}…` : short
}

function ChatMenu({ agent, threadId, canClear }: { agent: Agent; threadId: string; canClear: boolean }) {
  const clearChat = useClearChat(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const clearing = useRef<HTMLDialogElement>(null)
  const deleting = useRef<HTMLDialogElement>(null)
  return <>
    <Menu.Root>
      <Menu.Trigger className="btn icon" aria-label="More actions" title="More">{ICONS.more}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menupos" side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu">
            <Menu.Item className="menuitem" disabled={!canClear || clearChat.isPending} onClick={() => clearing.current?.showModal()}>{ICONS.eraser}Clear chat</Menu.Item>
            <Menu.Separator className="menusep" />
            <Menu.Item className="menuitem danger" disabled={!agent.canEdit || deleteAgent.isPending} onClick={() => deleting.current?.showModal()}>{ICONS.trash}Delete agent</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <ConfirmDialog dialogRef={clearing} question="Clear this chat?" detail={`${agent.name} starts a fresh conversation. It keeps what it saved to memory.`} action="Clear" onConfirm={() => clearChat.mutate(threadId, { onError: toastError })} />
    <ConfirmDialog dialogRef={deleting} question={`Delete ${agent.name}?`} detail="This can't be undone." action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })} />
  </>
}

function ChatEmpty({ agent, onTry }: { agent: Agent; onTry: (text: string) => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const start = <button type="button" className="btn primary" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: 'running' }, { onError: toastError })}>{ICONS.play}Start {agent.name}</button>
  const state = agentState(agent)
  const copy = {
    running: [`Ask ${agent.name} anything`, ''],
    starting: [`Starting ${agent.name}`, 'Hermes takes about a minute to start. You can type as soon as it answers.'],
    no_seat: [`${agent.name} isn't ready`, agent.healthDetail],
    not_answering: [`${agent.name} isn't answering`, agent.healthDetail || 'The container is running, but Hermes isn\'t answering.'],
    stopped: [`${agent.name} is stopped`, 'Start it to chat with it.'],
    missing: [`${agent.name} has an error`, 'Its container is gone. It is recreated within 30 seconds while it should be running.'],
  }[state]
  return <div className="chat-empty">
    <Avatar id={agent.id} about={agent.instructions} size={72} />
    <h3>{copy[0]}</h3>
    {copy[1] && <p>{copy[1]}</p>}
    {state === 'stopped' && start}
    {agent.wanted === 'stopped' && state === 'missing' && start}
    {state === 'not_answering' && <a className="btn primary" href={`/agents/${agent.id}`}>Settings</a>}
    {state === 'no_seat' && <a className="btn primary" href="/admin/seat">Connect the Claude seat</a>}
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
