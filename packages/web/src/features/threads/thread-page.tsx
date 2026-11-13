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
import { threadPath, useCreateThread, useThread, useTouchThread } from '@/features/threads/api'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[] }>
type AgentPart = AgentMessage['parts'][number]

const TRIES = ['What can you do?', 'Which data can you reach?', 'Summarize your instructions in one line.']
const firstMessages = new Map<string, string>()

export function ThreadPage({ me, threadId }: { me: Me; threadId: string }) {
  const thread = useThread(threadId)
  if (!thread.data) return <Page title="Thread"><ErrorNote message={thread.error?.message} /></Page>
  return <ThreadWithAgent me={me} thread={thread.data} />
}

function ThreadWithAgent({ me, thread }: { me: Me; thread: ThreadWithMessages }) {
  const agent = useAgent(thread.agentId)
  if (!agent.data) return <Page title={thread.title}><ErrorNote message={agent.error?.message} /></Page>
  return <ThreadView key={thread.id} me={me} thread={thread} agent={agent.data} />
}

export function NewThreadPage({ me, agentId }: { me: Me; agentId: string }) {
  const agent = useAgent(agentId)
  const createThread = useCreateThread()
  if (!agent.data) return <Page title="New thread"><ErrorNote message={agent.error?.message} /></Page>
  const send = (text: string) => createThread.mutate({ agentId, title: text }, {
    onSuccess: (thread) => {
      firstMessages.set(thread.id, text)
      navigate(`/threads/${thread.id}`, true)
    },
    onError: toastError,
  })
  return <ChatLayout me={me} agent={agent.data} title="New thread" busy={createThread.isPending} onSend={send} onStop={() => undefined}>
    <ChatEmpty agent={agent.data} onTry={send} />
  </ChatLayout>
}

function ThreadView({ me, thread, agent }: { me: Me; thread: ThreadWithMessages; agent: Agent }) {
  const touch = useTouchThread()
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: `${threadPath(thread.id)}/chat`,
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
  }), [thread.id])
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport, onFinish: () => touch(thread.id) })
  const { sendMessage } = chat
  useEffect(() => {
    const text = firstMessages.get(thread.id)
    if (!text) return
    firstMessages.delete(thread.id)
    void sendMessage({ text })
  }, [thread.id, sendMessage])
  const busy = chat.status === 'submitted' || chat.status === 'streaming'
  const send = (text: string) => {
    touch(thread.id)
    void sendMessage({ text })
  }
  const last = chat.messages.at(-1)
  return <ChatLayout me={me} agent={agent} title={thread.title} busy={busy} onSend={send} onStop={() => void chat.stop()}>
    {chat.messages.length ? chat.messages.map((message) => <Message key={message.id} me={me} agent={agent} message={message} live={busy && message === last} />) : <ChatEmpty agent={agent} onTry={send} />}
    {chat.status === 'submitted' && last?.role === 'user' && <Message me={me} agent={agent} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
    {chat.error && <div className="chat-err" role="alert"><span>{chat.error.message}</span><button type="button" className="btn sec sm" onClick={() => void chat.regenerate()}>Retry</button></div>}
  </ChatLayout>
}

function ChatLayout({ me, agent, title, busy, onSend, onStop, children }: { me: Me; agent: Agent; title: string; busy: boolean; onSend: (text: string) => void; onStop: () => void; children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })
  const actions = <><AgentBadge agent={agent} /><a className="btn sec sm" href={`/agents/${agent.id}`}>{ICONS.gear}<span className="lbl">Agent settings</span></a></>
  return <Page title={title} parents={[{ label: agent.name, href: `/agents/${agent.id}` }]} actions={actions} fill>
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
    <form className="composer" onSubmit={submit}>
      <Initial id={me.user.id} email={me.user.email} size={22} />
      <textarea name="text" rows={1} aria-label="Message" placeholder={ready ? `Message ${agent.name}` : `${agent.name} isn't ready yet`} disabled={!ready} autoFocus
        onKeyDown={enter} onInput={(event) => { const box = event.currentTarget; box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 160)}px` }} />
      <button type="submit" className={busy ? 'send stop' : 'send'} aria-label={busy ? 'Stop' : 'Send'} disabled={!busy && !ready}>{busy ? <span className="sq" /> : ICONS.up}</button>
    </form>
    <div className="chat-hint">Enter sends · Shift+Enter adds a line · only you see this thread</div>
  </div>
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

function ChatEmpty({ agent, onTry }: { agent: Agent; onTry: (text: string) => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const start = <button type="button" className="btn primary" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: 'running' }, { onError: toastError })}>{ICONS.play}Start {agent.name}</button>
  const state = agentState(agent)
  const copy = {
    running: [`Ask ${agent.name} anything`, 'Messages go to the running agent, with its real model, instructions and connections.'],
    starting: [`Starting ${agent.name}`, 'Hermes takes about a minute to start. You can type as soon as it answers.'],
    not_answering: [`${agent.name} isn't answering`, agent.healthDetail || 'The container is running, but Hermes isn\'t answering.'],
    stopped: [`${agent.name} is stopped`, 'Start it to chat with it.'],
    missing: [`${agent.name} has an error`, 'Its container is gone. Fast Monkey recreates it within 30 seconds while it should be running.'],
  }[state]
  return <div className="chat-empty">
    <Avatar id={agent.id} about={agent.instructions} size={72} />
    <h3>{copy[0]}</h3>
    <p>{copy[1]}</p>
    {state === 'running' && <div className="tries">{TRIES.map((text) => <button type="button" key={text} onClick={() => onTry(text)}>{text}</button>)}</div>}
    {state === 'stopped' && start}
    {agent.wanted === 'stopped' && state === 'missing' && start}
    {state === 'not_answering' && <a className="btn sec" href={`/agents/${agent.id}`}>Open agent settings</a>}
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
