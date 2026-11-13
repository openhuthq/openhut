import { useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { ChatCall, ToolProgress, type ChatMessage, type ThreadWithMessages } from '@fastmonkey/common/threads/thread.ts'
import { Avatar } from '@/components/avatar'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Page } from '@/components/page'
import { AgentBadge, agentState } from '@/components/status-badge'
import { useAgent, useUpdateAgent } from '@/features/agents/api'
import { threadPath, useAgentThread, useClearChat } from '@/features/threads/api'
import { ConfirmButton } from '@/components/confirm-button'
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
  const clear = <ClearChat agent={agent} threadId={thread.id} disabled={busy || !chat.messages.length} />
  return <ChatLayout me={me} agent={agent} busy={busy} onSend={send} onStop={() => void chat.stop()} extra={clear}>
    {chat.messages.length ? chat.messages.map((message) => <Message key={message.id} me={me} agent={agent} message={message} live={busy && message === last} />) : <ChatEmpty agent={agent} onTry={send} />}
    {chat.status === 'submitted' && last?.role === 'user' && <Message me={me} agent={agent} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
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
  const actions = <><AgentBadge agent={agent} />{extra}<a className="btn ghost sm" href={`/agents/${agent.id}`}>{ICONS.gear}<span className="lbl">Settings</span></a></>
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
      <textarea name="text" rows={3} aria-label="Message" placeholder={ready ? `Message ${agent.name}…` : `${agent.name} isn't ready yet`} disabled={!ready} autoFocus
        onKeyDown={enter} onInput={(event) => { const box = event.currentTarget; box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
      <div className="composer-bar">
        <button type="submit" className={busy ? 'send stop' : 'send'} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && !ready}>{busy ? <span className="sq" /> : ICONS.enter}</button>
      </div>
    </form>
  </div>
}

function NotReady({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const reason = {
    starting: 'Hermes is still starting. You can type as soon as it answers.',
    no_seat: agent.healthDetail,
    not_answering: agent.healthDetail || 'Hermes isn\'t answering.',
    stopped: 'It\'s stopped. Start it from Settings.',
    missing: 'Its container is gone. Fast Monkey recreates it within 30 seconds while it should be running.',
    running: '',
  }[state]
  const action = state === 'no_seat' ? <a href="/admin/seat">Connect the seat</a> : state !== 'starting' && <a href={`/agents/${agent.id}`}>Settings</a>
  return <div className="chat-notice" role="status"><b>{agent.name} isn't ready.</b> {reason} {action}</div>
}

function Message({ me, agent, message, live }: { me: Me; agent: Agent; message: AgentMessage; live: boolean }) {
  if (message.role === 'user') {
    return <div className="msg">
      <Initial id={me.user.id} email={me.user.email} size={32} />
      <div className="msg-b"><div className="msg-h"><b>{me.user.email.split('@')[0]}</b></div><div className="msg-t plain">{textOf(message)}</div></div>
    </div>
  }
  const hasText = message.parts.some((part) => part.type === 'text' && part.text)
  return <div className="msg">
    <span className={live ? 'talking' : undefined}><Avatar id={agent.id} about={agent.instructions} size={32} /></span>
    <div className="msg-b">
      <div className="msg-h"><b>{agent.name}</b></div>
      {message.parts.map((part, index) => <Part key={index} part={part} />)}
      {live && !hasText && <span className="typing" aria-label={`${agent.name} is thinking`}><i /><i /><i /></span>}
    </div>
  </div>
}

function Part({ part }: { part: AgentPart }) {
  switch (part.type) {
    case 'text': return <div className="msg-t"><Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown></div>
    case 'data-tool': return <div className="tool-use">{ICONS.ext}Using {part.data.label ?? part.data.tool ?? part.data.name ?? 'a tool'}</div>
    case 'data-calls': return <div className="calls">{part.data.map((call, index) => <details className="call" key={index}>
      <summary><span className="mono">{call.tool}</span><span className="mute ellip">{call.connectionName ?? ''}</span><span className={`status ${call.outcome === 'allowed' ? 'success' : 'destructive'}`}>{call.outcome === 'allowed' ? 'Allowed' : call.outcome === 'denied' ? 'Denied' : 'Failed'}</span><span className="mono mute">{call.ms} ms</span></summary>
      <p>{call.reason}</p>
    </details>)}</div>
    default: return null
  }
}

function ClearChat({ agent, threadId, disabled }: { agent: Agent; threadId: string; disabled: boolean }) {
  const clearChat = useClearChat(agent.id)
  return <span title="Clear chat"><ConfirmButton className="btn ghost sm" disabled={disabled || clearChat.isPending} question="Clear this chat?" detail={`${agent.name} starts a fresh conversation. It keeps what it saved to memory.`} action="Clear" onConfirm={() => clearChat.mutate(threadId, { onError: toastError })}>
    {ICONS.eraser}<span className="lbl">Clear</span>
  </ConfirmButton></span>
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
    missing: [`${agent.name} has an error`, 'Its container is gone. Fast Monkey recreates it within 30 seconds while it should be running.'],
  }[state]
  return <div className="chat-empty">
    <Avatar id={agent.id} about={agent.instructions} size={72} />
    <h3>{copy[0]}</h3>
    {copy[1] && <p>{copy[1]}</p>}
    {state === 'stopped' && start}
    {agent.wanted === 'stopped' && state === 'missing' && start}
    {state === 'not_answering' && <a className="btn sec" href={`/agents/${agent.id}`}>Open agent settings</a>}
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
