import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ArrowDown02Icon, ArrowLeft01Icon, ArrowUpRight01Icon, PlayIcon } from '@hugeicons/core-free-icons'
import { openhut, type OpenHutAgent } from '@/lib/openhut'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ErrorNote } from '@/components/error-note'
import { I, ICON_BUTTON } from '@/components/kit'
import { useOwner } from '@/lib/queries/people'
import { SidebarContext, usePhoneBack } from '@/lib/layout'
import { agentState } from '@/components/status-badge'
import { RetryApply, troubleOf } from '@/components/agent-status'
import { useAgents, useUpdateAgent } from '@/lib/queries/agents'
import { Face } from '@/components/agent-face'
import { agentPath } from '@/config/paths'
import { saveFile, stopThread, threadPath, useThread, useTouchThread, type ThreadWithMessages } from '@/features/threads/api/threads'
import { PLATFORM_WORD, placeName, startedIn, type SourcedThread } from '@/lib/places'
import { PlaceIcon } from '@/components/place-icon'
import { saidAfter } from '@/lib/said-after'
import { CardReply } from '@/features/threads/components/card'
import { plainError, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { stillPinned } from '@/lib/more-below'
import { useJoinThread } from '@/lib/thread-live'
import { webhookOf } from '@/features/threads/components/webhook-message'
import { ChatAsks, ChatFiles, Day, Message, AgentReply, Authored, changesOf, workOf, uiMessageOf, type AgentMessage, type AskSlots } from '@/features/threads/components/messages'
import { Composer, ComposerSkeleton, ClearChat } from '@/features/threads/components/composer'
import { useAttachments, fileDrop } from '@/features/threads/components/file-drop'

export function Chat({ agent, threadId, asks, actions, tools: after, onTitle }: { agent: Agent; threadId: string; asks: AskSlots; actions?: ReactNode; tools?: ReactNode; onTitle?: () => void }) {
  const tools = <>{actions}{after}</>
  const thread = useThread({ agentId: agent.id, threadId })
  if (agentState(agent) === 'stopped') return <ChatFrame agent={agent} tools={tools} onTitle={onTitle}><Asleep agent={agent} /></ChatFrame>
  if (!thread.data) return <ChatFrame agent={agent} tools={tools} onTitle={onTitle} composer={<ComposerSkeleton />}><div className="m-auto"><ErrorNote message={thread.error?.message} /></div></ChatFrame>
  return <ThreadView key={thread.data.id} thread={thread.data} fetchedAt={thread.dataUpdatedAt} agent={agent} asks={asks} actions={actions} tools={after} onTitle={onTitle} />
}

function ThreadView({ thread, fetchedAt, agent, asks, actions, tools, onTitle }: { thread: ThreadWithMessages; fetchedAt: number; agent: Agent; asks: AskSlots; actions: ReactNode; tools: ReactNode; onTitle?: () => void }) {
  const touch = useTouchThread()
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: `${threadPath(thread.id)}/chat`,
    fetch: (url, init) => openhut.fetch({ path: String(url), init }),
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
    prepareReconnectToStreamRequest: () => ({ api: `${threadPath(thread.id)}/stream` }),
  }), [thread.id, agent.id])
  const [status, setStatus] = useState('')
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport, onData: (part) => { if (part.type === 'data-status') setStatus(part.data.text) }, onFinish: () => { setStatus(''); touch(thread) } })
  const attachments = useAttachments({ agentId: agent.id, threadId: thread.id })
  const files = useMemo(() => ({ agentId: agent.id, threadId: thread.id, save: (path: string) => void saveFile({ agentId: agent.id, threadId: thread.id, path }).catch(toastError) }), [agent.id, thread.id])
  const streaming = chat.status === 'submitted' || chat.status === 'streaming'
  const ready = !streaming
  const busy = streaming || !!thread.activeTurn
  useJoinThread(thread.id)
  const me = useOwner()
  useEffect(() => { if (ready) chat.setMessages(thread.messages.map(uiMessageOf)) }, [thread.messages])
  useEffect(() => { if (ready && thread.activeTurn) void chat.resumeStream() }, [thread.activeTurn, fetchedAt, ready])
  const send = (text: string) => {
    touch(thread)
    const files = attachments.items.flatMap(({ file }) => file ? [{ type: 'file' as const, mediaType: file.mediaType, filename: file.name, url: file.path }] : [])
    void chat.sendMessage(files.length ? { text, files } : { text })
    attachments.clear()
  }
  const retry = () => void (thread.activeTurn ? chat.resumeStream() : chat.regenerate())
  const shown = agent.runsHere ? chat.messages : chat.messages.filter((message) => message.role === 'user' || message.parts.some((part) => part.type !== 'step-start'))
  const last = shown.at(-1)
  const waiting = busy && !(last?.role === 'assistant' && (streaming || last.id === thread.activeTurn))
  const mine = [...shown].reverse().find((message) => message.role === 'user' && !webhookOf(message.metadata) && (z.safeParse(Authored, message.metadata).data?.author ?? me) === me)
  const said = saidAfter(shown)
  const clear = agent.canEdit && chat.messages.length > 0 && <ClearChat agent={agent} threadId={thread.id} attachments={attachments} disabled={busy || attachments.uploading} />
  return <ChatAsks value={asks}><ChatFiles value={files}><CardReply value={thread.readOnly ? undefined : (text) => { if (busy) return false; send(text); return true }}><ChatFrame agent={agent} thread={thread} tools={<>{actions}{tools}</>} onTitle={onTitle} onFiles={attachments.add} composer={thread.readOnly ? <ContinueBar thread={thread} /> : <Composer agent={agent} threadId={thread.id} busy={busy} quiet={!chat.messages.length} attachments={attachments} clear={clear} onSend={send} onStop={() => void stopThread({ agentId: agent.id, threadId: thread.id }).catch(toastError)} />}>
    {shown.length ? <>
      <Welcome agent={agent} />
      <Day iso={thread.updatedAt} />
      {shown.map((message, index) => <Message key={message.id} agent={agent} thread={thread} message={message} said={(text) => said(index, text)} seen={message === mine} live={message === last && (chat.status === 'streaming' || (busy && message.role === 'assistant'))} step={message === last && status ? status : undefined} onRetry={!busy && !thread.readOnly && message === last ? () => void chat.regenerate() : undefined} />)}
    </> : !waiting && <ChatEmpty agent={agent} />}
    {waiting && <AgentReply agent={agent} threadId={thread.id} message={{ id: 'waiting', role: 'assistant', parts: [] }} step={status || undefined} live />}
    <asks.Pending agent={agent} shown={new Set(chat.messages.flatMap(changesOf))} />
    {!agent.runsHere && !busy && last?.role === 'user' && !troubleOf(agent) && <p className="m-0 text-right text-[12.5px] text-mute">{agent.runsNowhere ? `No computer runs ${agent.name} now. ${agent.canManage ? 'Run it here to get an answer.' : `Ask an admin to run ${agent.name} on their computer.`}` : `Sent to ${agent.runsOnName ?? 'your other computer'}. ${agent.name} answers when it’s on.`}</p>}
    {chat.error && !busy && !(last && workOf(last)?.error) && <Alert variant="error-outline" role="alert"><span>{plainError(chat.error.message)}</span><Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={retry}>Try again</Button></Alert>}
  </ChatFrame></CardReply></ChatFiles></ChatAsks>
}

function ChatFrame({ agent, thread, composer, tools, onTitle, onFiles, children }: { agent: Agent; thread?: SourcedThread; composer?: ReactNode; tools?: ReactNode; onTitle?: () => void; onFiles?: (files: File[]) => void; children: ReactNode }) {
  const back = usePhoneBack()
  const log = useRef<HTMLDivElement>(null)
  const sidebar = useContext(SidebarContext)
  const pinned = useRef(true)
  const lastTop = useRef(0)
  const [away, setAway] = useState(false)
  const stick = () => {
    const element = log.current
    if (!element || !pinned.current) return
    element.scrollTop = element.scrollHeight
    lastTop.current = element.scrollTop
  }
  useLayoutEffect(stick)
  useLayoutEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(stick)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    pinned.current = true
    setAway(false)
    stick()
  }, [thread?.id])
  return <section className="flex min-w-0 flex-1 flex-col bg-card" {...fileDrop(onFiles)}>
    <title>{`${agent.name} · OpenHut`}</title>
    <div className={cn('still relative flex h-[116px] shrink-0 items-start gap-2 px-4 pt-3 phone:grid phone:items-center phone:pt-0 phone:h-16 phone:grid-cols-[1fr_auto_1fr] phone:px-3', sidebar?.collapsed && 'pl-[94px] phone:pl-3')}>
      <Button type="button" variant="bare" aria-label="All agents" className={cn(ICON_BUTTON, 'float hidden size-10 justify-self-start rounded-full bg-card text-ink phone:grid')} onClick={back}><I icon={ArrowLeft01Icon} size={20} /></Button>
      {onTitle
        ? <Button type="button" variant="bare" className="float flex h-10 min-w-0 items-center gap-2 rounded-full bg-card pr-4 pl-1.5 text-ink" onClick={onTitle}><Face agent={agent} size={28} /><span className="truncate text-[16px] font-semibold">{agent.name}</span></Button>
        : <>{thread && thread.id !== agent.id && <span className="min-w-0 truncate text-[13px] text-mute">{thread.title}</span>}{thread && <ThreadSource thread={thread} />}{agent.applyError && <RetryApply agent={agent} />}</>}
      {!onTitle && <span className="absolute top-3 left-1/2 flex max-w-[50%] -translate-x-1/2 flex-col items-center gap-2 phone:hidden">
        <a href={agentPath(agent.canEdit ? { agentId: agent.id, dialog: 'customize' } : { agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={agent.canEdit ? `Customize ${agent.name}` : `Set up ${agent.name}`} title={agent.canEdit ? 'Customize' : undefined} className="rounded-full"><Face agent={agent} size={56} /></a>
        <a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className="max-w-full truncate rounded-full bg-soft px-3.5 py-1 text-[14px] font-medium text-ink no-underline hover:bg-mid">{agent.name}</a>
      </span>}
      <span className="float ml-auto flex items-center gap-0.5 phone:h-10 phone:justify-self-end phone:rounded-full phone:bg-card phone:px-1">{tools}</span>
    </div>
    <div ref={log} className="fade-t flex flex-1 flex-col overflow-auto px-8 py-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-4" aria-live="polite" onScroll={(event) => {
      const element = event.currentTarget
      pinned.current = stillPinned({ pinned: pinned.current, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, clientHeight: element.clientHeight, lastTop: lastTop.current })
      lastTop.current = element.scrollTop
      setAway(!pinned.current)
    }}>
      <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col gap-4">{children}</div>
    </div>
    {away && <div className="relative h-0 px-8 group-data-[threads]/chat:pr-[396px] phone:px-3"><div className="relative mx-auto max-w-[840px]">
      <Button type="button" variant="bare" aria-label="Scroll to the latest message" title="Scroll to bottom" className="absolute -top-12 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-hair bg-card text-ink shadow-pop hover:bg-hover"
        onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' })}><I icon={ArrowDown02Icon} size={18} /></Button>
    </div></div>}
    {composer}
  </section>
}

function ThreadSource({ thread }: { thread: SourcedThread }) {
  const url = thread.origin?.url
  if (!url) return null
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[12.5px] text-mute no-underline hover:text-ink phone:hidden">
    <span className="truncate">Started in {startedIn(thread)}</span><I icon={ArrowUpRight01Icon} size={12} />
  </a>
}

function ContinueBar({ thread }: { thread: SourcedThread }) {
  const place = thread.place
  const where = place ? PLATFORM_WORD[place.platform] ?? place.platform : 'the other app'
  return <div className="shrink-0 px-8 pb-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-3 phone:pb-3">
    <div className="mx-auto flex max-w-[840px] items-center gap-2.5 rounded-xl bg-sidebar py-2.5 pr-2.5 pl-3.5 text-[13.5px] text-body phone:flex-wrap">
      {place && <PlaceIcon platform={place.platform} size={16} />}
      <span className="min-w-0 flex-1">This conversation continues in {place?.chat_name ? placeName(place) : where}</span>
      {thread.continueUrl && <a href={thread.continueUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open in {where}<span className="text-[11px] text-mute">↗</span></a>}
    </div>
  </div>
}

function useOffline(agent: Agent) {
  const home: OpenHutAgent | undefined = useAgents().data?.find((each) => each.id === agent.id)
  return home && !home.online
}

function ChatEmpty({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const offline = useOffline(agent)
  const note = offline ? `${agent.name}'s computer is offline. It answers when it's back.` : {
    running: '',
    starting: `Starting ${agent.name}. You can type now.`,
    no_seat: `${agent.name} needs a model to answer.`,
    setup_failed: `${agent.name} couldn't start. OpenHut keeps trying.`,
    not_answering: `${agent.name} isn't answering. It restarts on its own.`,
    stopped: '',
    missing: `${agent.name} stopped. It comes back within 30 seconds.`,
  }[state]
  const detail = state === 'not_answering' || state === 'setup_failed' ? agent.healthDetail : ''
  return <Welcome agent={agent}>{note && <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-mute">{note}{state === 'no_seat' && <a href="/settings/models" className="text-ink underline underline-offset-2">Connect a model</a>}</p>}{detail && <Details text={detail} />}</Welcome>
}

function Welcome({ agent, children }: { agent: Agent; children?: ReactNode }) {
  return <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
    <Face agent={agent} size={34} />
    <div className="flex min-w-0 flex-col gap-2 pt-1.5 text-[15px]/[1.6] text-ink">
      <p className="m-0">Hey! I’m {agent.name}.</p>
      <p className="m-0">{agent.summary || 'Ask me anything, or tell me what my job is.'}</p>
      {children}
    </div>
  </div>
}

function Asleep({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Centered agent={agent} title={`${agent.name} is stopped`} line="It won't answer here or on its channels until you start it. Its memory and chats are kept." dim>
    <Button type="button" variant="primary" className="mt-1 gap-1.5" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: 'running' }, { onError: toastError })}><I icon={PlayIcon} size={14} />Start</Button>
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
