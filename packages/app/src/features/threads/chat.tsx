import { createContext, useContext, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SpecDataPart } from '@json-render/core'
import { useJsonRenderMessage } from '@json-render/react'
import { ArrowDown02Icon, ArrowLeft01Icon, ArrowUp02Icon, ArrowUpRight01Icon, Attachment01Icon, Cancel01Icon, Copy01Icon, EraserIcon, File01Icon, Image01Icon, PlayIcon } from '@hugeicons/core-free-icons'
import { openhut, type OpenHutAgent } from '@/lib/openhut'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChatCall, fileInHome, MAX_FILE_BYTES, MAX_FILES, ToolProgress, Work, type ChatFile, type ChatMessage } from '@openhut/common/threads/thread.ts'
import { Alert } from '@/components/ui/alert'
import { Tooltip } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-button'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenuItem, LongPressMenu } from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { Dots, HINT, I, ICON_BUTTON } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { useOwner } from '@/features/people/api'
import { personName } from '@/lib/format'
import { SidebarContext } from '@/features/agents/sidebar'
import { agentState } from '@/components/status-badge'
import { RetryApply, troubleOf } from '@/features/agents/status'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { agentPath } from '@/config/paths'
import { deleteUpload, saveFile, stopThread, threadPath, uploadFile, useClearChat, useHomeFiles, useThread, useThumb, useTouchThread, type ThreadWithMessages } from '@/features/threads/api'
import { replyOf, replyText } from '@openhut/common/threads/reply.ts'
import { Notified, PLATFORM_WORD, placeName, startedIn, type SourcedThread } from '@/features/threads/places'
import { PlaceIcon } from '@/features/routines/target-picker'
import { doneText, WebhookSetup, WebhookSetupCard } from '@/features/webhooks/setup-card'
import { saidAfter } from '@/lib/said-after'
import { homePathsIn, linkHomeFiles, RASTER } from '@/features/threads/files'
import { errorUnder, legacyWork, withoutCards } from '@/features/threads/steps'
import { RetryButton, WorkLine } from '@/features/threads/work'
import { CardReply, MessageCard } from '@/features/threads/card'
import { CodeBlock } from '@/features/threads/code'
import { bullets, settled } from '@/features/threads/markdown'
import { AskCards, PendingAsks } from '@/features/asks/card'
import { copyText } from '@/lib/clipboard'
import { plainError, toast, toastError, toastFailed } from '@/lib/toast'
import { usePhoneBack } from '@/app/phone-page'
import { TOUCH, useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'
import { ICONS } from '@/components/icons'
import { useJoinThread, useTyping } from '@/lib/thread-live'
import { LiveTitle, PresenceFaces, SeenBy, TypingNow } from '@/features/threads/live'
import { CallText, webhookOf, WebhookMessage } from '@/features/webhooks/message'
import { callOf } from '@/features/webhooks/call'
import { CallCardMessage } from '@/features/webhooks/call-card'

type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[]; work: Work; spec: SpecDataPart; asks: string[]; notified: Notified; 'webhook-setup': WebhookSetup; step: Record<string, never> }>
type AgentPart = AgentMessage['parts'][number]
type Attachment = { key: string; name: string; image: boolean; thumb?: string; file?: ChatFile }

const ChatFiles = createContext<{ agentId: string; threadId: string; save: (path: string) => void }>({ agentId: '', threadId: '', save: () => undefined })
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export function Chat({ agent, threadId, actions, tools: after, onTitle }: { agent: Agent; threadId: string; actions?: ReactNode; tools?: ReactNode; onTitle?: () => void }) {
  const tools = <>{actions}{after}</>
  const thread = useThread({ agentId: agent.id, threadId })
  if (agentState(agent) === 'stopped') return <ChatFrame agent={agent} tools={tools} onTitle={onTitle}><Asleep agent={agent} /></ChatFrame>
  if (!thread.data) return <ChatFrame agent={agent} tools={tools} onTitle={onTitle} composer={<ComposerSkeleton />}><div className="m-auto"><ErrorNote message={thread.error?.message} /></div></ChatFrame>
  return <ThreadView key={thread.data.id} thread={thread.data} fetchedAt={thread.dataUpdatedAt} agent={agent} actions={actions} tools={after} onTitle={onTitle} />
}

function ThreadView({ thread, fetchedAt, agent, actions, tools, onTitle }: { thread: ThreadWithMessages; fetchedAt: number; agent: Agent; actions: ReactNode; tools: ReactNode; onTitle?: () => void }) {
  const touch = useTouchThread()
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: `${threadPath(thread.id)}/chat`,
    fetch: (url, init) => openhut.fetch({ path: String(url), init }),
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
    prepareReconnectToStreamRequest: () => ({ api: `${threadPath(thread.id)}/stream` }),
  }), [thread.id, agent.id])
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport, onFinish: () => touch(thread) })
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
  const waiting = busy && chat.status !== 'streaming' && !(last?.role === 'assistant' && last.id === thread.activeTurn)
  const mine = [...shown].reverse().find((message) => message.role === 'user' && !webhookOf(message.metadata) && (z.safeParse(Authored, message.metadata).data?.author ?? me) === me)
  const said = saidAfter(shown)
  const clear = agent.canEdit && chat.messages.length > 0 && <ClearChat agent={agent} threadId={thread.id} attachments={attachments} disabled={busy || attachments.uploading} />
  return <ChatFiles value={files}><CardReply value={thread.readOnly ? undefined : (text) => { if (busy) return false; send(text); return true }}><ChatFrame agent={agent} thread={thread} tools={<>{actions}{tools}</>} onTitle={onTitle} onFiles={attachments.add} composer={thread.readOnly ? <ContinueBar thread={thread} /> : <Composer agent={agent} threadId={thread.id} busy={busy} quiet={!chat.messages.length} attachments={attachments} clear={clear} onSend={send} onStop={() => void stopThread({ agentId: agent.id, threadId: thread.id }).catch(toastError)} />}>
    {shown.length ? <>
      <Welcome agent={agent} />
      <Day iso={thread.updatedAt} />
      {shown.map((message, index) => <Message key={message.id} agent={agent} thread={thread} message={message} said={(text) => said(index, text)} seen={message === mine} live={chat.status === 'streaming' && message === last} onRetry={!busy && !thread.readOnly && message === last ? () => void chat.regenerate() : undefined} />)}
    </> : !waiting && <ChatEmpty agent={agent} />}
    {waiting && <AgentReply agent={agent} threadId={thread.id} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
    <PendingAsks agent={agent} shown={new Set(chat.messages.flatMap(changesOf))} />
    {!agent.runsHere && !busy && last?.role === 'user' && !troubleOf(agent) && <p className="m-0 text-right text-[12.5px] text-mute">{agent.runsNowhere ? `No computer runs ${agent.name} now. ${agent.canManage ? 'Run it here to get an answer.' : `Ask an admin to run ${agent.name} on their computer.`}` : `Sent to ${agent.runsOnName ?? 'your other computer'}. ${agent.name} answers when it’s on.`}</p>}
    {!thread.readOnly && <TypingNow threadId={thread.id} />}
    {chat.error && !busy && !(last && workOf(last)?.error) && <Alert variant="error-outline" role="alert"><span>{plainError(chat.error.message)}</span><Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={retry}>Try again</Button></Alert>}
  </ChatFrame></CardReply></ChatFiles>
}

function useAttachments({ agentId, threadId }: { agentId: string; threadId: string }) {
  const [items, setItems] = useState<Attachment[]>([])
  const taken = useRef(new Set<string>())
  const current = useRef(items)
  current.current = items
  const forget = (path: string) => void deleteUpload({ agentId, threadId, path }).catch(() => undefined)
  const drop = (key: string) => {
    taken.current.delete(key)
    const item = current.current.find((each) => each.key === key)
    if (item?.thumb) URL.revokeObjectURL(item.thumb)
    setItems((list) => list.filter((each) => each.key !== key))
    return item
  }
  const add = (files: File[]) => {
    for (const file of files) {
      if (taken.current.size >= MAX_FILES) return toastFailed('Too many files', `Attach up to ${MAX_FILES} per message.`)
      if (file.size > MAX_FILE_BYTES) {
        toastFailed(`${file.name} is too big`, `Attach files up to ${MAX_FILE_BYTES >> 20} MB.`)
        continue
      }
      const key = crypto.randomUUID()
      const raster = RASTER.includes(file.type)
      taken.current.add(key)
      setItems((list) => [...list, { key, name: file.name, image: file.type.startsWith('image/'), thumb: raster ? URL.createObjectURL(file) : undefined }])
      uploadFile({ agentId, threadId, file }).then(
        (saved) => {
          if (!taken.current.has(key)) return forget(saved.path)
          setItems((list) => list.map((each) => each.key === key ? { ...each, file: saved } : each))
        },
        (error: Error) => {
          drop(key)
          toastError(error)
        },
      )
    }
  }
  const remove = (key: string) => {
    const item = drop(key)
    if (item?.file) forget(item.file.path)
  }
  const clear = () => {
    for (const item of current.current) if (item.thumb) URL.revokeObjectURL(item.thumb)
    taken.current.clear()
    current.current = []
    setItems([])
  }
  useEffect(() => () => {
    taken.current.clear()
    for (const item of current.current) if (item.file) forget(item.file.path)
  }, [])
  return { items, add, uploading: items.some((each) => !each.file), remove, clear }
}

type Attachments = ReturnType<typeof useAttachments>

function ChatFrame({ agent, thread, composer, tools, onTitle, onFiles, children }: { agent: Agent; thread?: SourcedThread; composer?: ReactNode; tools?: ReactNode; onTitle?: () => void; onFiles?: (files: File[]) => void; children: ReactNode }) {
  const back = usePhoneBack()
  const log = useRef<HTMLDivElement>(null)
  const sidebar = useContext(SidebarContext)
  const pinned = useRef(true)
  const [away, setAway] = useState(false)
  useEffect(() => {
    const element = log.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  })
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (pinned.current) element.scrollTop = element.scrollHeight })
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    pinned.current = true
    setAway(false)
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [thread?.id])
  const dragOver = (event: DragEvent) => {
    if (onFiles && event.dataTransfer.types.includes('Files')) event.preventDefault()
  }
  const drop = (event: DragEvent) => {
    if (!onFiles || !event.dataTransfer.files.length) return
    event.preventDefault()
    onFiles(Array.from(event.dataTransfer.files))
  }
  return <section className="flex min-w-0 flex-1 flex-col bg-card" onDragOver={dragOver} onDrop={drop}>
    <title>{`${agent.name} · OpenHut`}</title>
    <div className={cn('still relative flex h-[116px] shrink-0 items-start gap-2 px-4 pt-3 phone:grid phone:items-center phone:pt-0 phone:h-16 phone:grid-cols-[1fr_auto_1fr] phone:px-3', sidebar?.collapsed && 'pl-[94px] phone:pl-3')}>
      <Button type="button" variant="bare" aria-label="All agents" className={cn(ICON_BUTTON, 'float hidden size-10 justify-self-start rounded-full bg-card text-ink phone:grid')} onClick={back}><I icon={ArrowLeft01Icon} size={20} /></Button>
      {onTitle
        ? <Button type="button" variant="bare" className="float flex h-10 min-w-0 items-center gap-2 rounded-full bg-card pr-4 pl-1.5 text-ink" onClick={onTitle}><Face agent={agent} size={28} /><span className="truncate text-[16px] font-semibold">{agent.name}</span></Button>
        : <>{thread && thread.id !== agent.id && <span className="min-w-0 truncate text-[13px] text-mute">{thread.title}</span>}{thread && <ThreadSource thread={thread} />}{agent.applyError && <RetryApply agent={agent} />}</>}
      {!onTitle && <a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className="group absolute top-3 left-1/2 flex max-w-[50%] -translate-x-1/2 flex-col items-center gap-2 text-ink no-underline phone:hidden">
        <Face agent={agent} size={56} /><span className="max-w-full truncate rounded-full bg-soft px-3.5 py-1 text-[14px] font-medium group-hover:bg-mid">{agent.name}</span>
      </a>}
      <span className="float ml-auto flex items-center gap-0.5 phone:h-10 phone:justify-self-end phone:rounded-full phone:bg-card phone:px-1">{tools}</span>
    </div>
    <div ref={log} className="fade-t flex flex-1 flex-col overflow-auto px-8 py-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-4" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; setAway(!pinned.current) }}>
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

function NotifiedRow({ notified }: { notified: Notified[number] }) {
  return <span className="inline-flex items-center gap-1.5 text-[12.5px] text-mute" title={notified.text}><PlaceIcon platform={notified.place.platform} size={12} />Notified {placeName(notified.place)}</span>
}

function Day({ iso }: { iso: string }) {
  const date = new Date(iso)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })
  return <div className="flex items-center gap-3 text-[11.5px] text-mute-2"><span className="h-px flex-1 bg-hair" />{label}<span className="h-px flex-1 bg-hair" /></div>
}

function ComposerSkeleton() {
  return <div className="shrink-0 px-8 pb-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-3 phone:pb-3"><div className="mx-auto h-[108px] max-w-[840px] rounded-[22px] border border-hair bg-sidebar" /></div>
}

function Composer({ agent, threadId, busy, quiet, attachments, clear, onSend, onStop }: { agent: Agent; threadId: string; busy: boolean; quiet: boolean; attachments: Attachments; clear?: ReactNode; onSend: (text: string) => void; onStop: () => void }) {
  const touch = useMedia(TOUCH)
  const [empty, setEmpty] = useState(true)
  const picker = useRef<HTMLInputElement>(null)
  const state = agentState(agent)
  const ready = !BLOCKED.includes(state)
  const starting = state === 'starting' || state === 'missing'
  const nothing = empty && !attachments.items.length
  const typing = useTyping(threadId)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const box = event.currentTarget.elements.namedItem('text')
    if (busy) return onStop()
    if (!(box instanceof HTMLTextAreaElement) || attachments.uploading || (!box.value.trim() && !attachments.items.length)) return
    onSend(box.value.trim())
    typing.stop()
    box.value = ''
    box.style.height = ''
    setEmpty(true)
  }
  const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (touch || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!event.clipboardData.files.length) return
    event.preventDefault()
    attachments.add(Array.from(event.clipboardData.files))
  }
  return <div className="shrink-0 px-8 pb-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-3 phone:pb-3">
    {(!ready || state === 'not_answering') && !busy && !quiet && <NotReady agent={agent} />}
    {starting && <p className={cn(HINT, 'mx-auto mb-2 flex max-w-[840px] items-center gap-1.5')} role="status"><Spinner className="mt-0 size-3" />Starting… your message will send.</p>}
    <form className="mx-auto flex max-w-[840px] flex-col gap-2 rounded-[22px] border border-ink bg-sidebar px-3 pt-3 pb-2.5 shadow-[0_6px_24px_-12px_oklch(0%_0_0/.18)] transition-[border-color,box-shadow] focus-within:shadow-[0_8px_28px_-12px_oklch(0%_0_0/.26)]" onSubmit={submit}>
      {attachments.items.length > 0 && <div className="flex flex-wrap gap-1.5">{attachments.items.map((each) => <FileChip key={each.key} name={each.name} image={each.image} thumb={each.thumb} busy={!each.file} onRemove={() => attachments.remove(each.key)} />)}</div>}
      <Input ref={picker} type="file" multiple hidden onChange={(event) => { attachments.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
      <Textarea variant="composer" name="text" rows={2} aria-label="Message" placeholder={placeholderOf(agent)} disabled={!ready} autoFocus={!touch}
          className="min-h-[48px] w-full px-1.5 py-0.5 text-[15px]/[1.55]" onKeyDown={enter} onPaste={paste} onBlur={typing.stop}
          onInput={(event) => { const box = event.currentTarget; setEmpty(!box.value.trim()); if (box.value.trim()) typing.ping(); else typing.stop(); box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
      <div className="flex items-center gap-1">
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Attach files" title="Attach files" disabled={!ready} onClick={() => picker.current?.click()}><I icon={Attachment01Icon} size={16} /></Button>
        {clear}
        <span className="ml-auto flex items-center gap-2"><PresenceFaces agent={agent} threadId={threadId} /><Button type="submit" variant="send" className="rounded-full" onMouseDown={(event) => event.preventDefault()} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && (!ready || nothing || attachments.uploading)}>{busy ? <span className="size-2.5 rounded-[2px] bg-white" /> : <I icon={ArrowUp02Icon} className="text-white" />}</Button></span>
      </div>
    </form>
  </div>
}

const BLOCKED: string[] = ['stopped', 'no_seat', 'setup_failed']

function placeholderOf(agent: Agent) {
  const state = agentState(agent)
  if (!BLOCKED.includes(state)) return `Ask ${agent.name} anything…`
  if (state === 'stopped') return `${agent.name} is stopped`
  return `${agent.name} isn't ready yet`
}

function NotReady({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const reason = {
    starting: 'It\'s still starting. You can type as soon as it answers.',
    no_seat: 'Its model isn\'t connected.',
    setup_failed: agent.healthDetail,
    not_answering: 'It restarts on its own. You can also stop it and start it again.',
    stopped: '',
    missing: 'It comes back by itself within 30 seconds.',
    running: '',
  }[state]
  return <Alert variant="warning" className="max-w-[840px]" role="status" title={agent.healthDetail || undefined}><b>{agent.name} isn't ready.</b> {reason} {state === 'no_seat' && <a href="/settings/models">Open Settings › Models</a>}</Alert>
}

function ClearChat({ agent, threadId, attachments, disabled }: { agent: Agent; threadId: string; attachments: Attachments; disabled: boolean }) {
  const clearChat = useClearChat({ agentId: agent.id, threadId })
  const uploads = attachments.items.flatMap((item) => item.file ? [item.file.path] : [])
  const [asking, setAsking] = useState(false)
  return <>
    <Tooltip label="Clear chat"><Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Clear chat" disabled={disabled} onClick={() => setAsking(true)}><I icon={EraserIcon} size={16} /></Button></Tooltip>
    <ConfirmDialog open={asking} onOpenChange={setAsking} question="Clear this chat?" detail="Memory stays. Files you sent are deleted." action="Clear"
      onConfirm={() => clearChat.mutateAsync({ uploads }).then(() => attachments.clear())} />
  </>
}

function useOffline(agent: Agent) {
  const home: OpenHutAgent | undefined = useAgents().data?.find((each) => each.id === agent.id)
  return home && !home.online
}

function Message({ agent, thread, message, said, seen, live, onRetry }: { agent: Agent; thread: SourcedThread; message: AgentMessage; said: (text: string) => boolean; seen: boolean; live: boolean; onRetry?: () => void }) {
  const webhook = webhookOf(message.metadata)
  if (webhook && !callOf(message.metadata) && message.role === 'user') return <WebhookMessage webhook={webhook} at={thread.createdAt} />
  return message.role === 'user' ? <UserMessage message={message} seen={seen ? thread.id : undefined} /> : <AgentReply agent={agent} threadId={thread.id} message={message} said={said} live={live} onRetry={onRetry} />
}

function AgentReply({ agent, threadId: liveThread, step, message, said, live, onRetry }: { agent: Agent; threadId?: string; step?: string; message: AgentMessage; said?: (text: string) => boolean; live: boolean; onRetry?: () => void }) {
  const { agentId, threadId } = useContext(ChatFiles)
  const blocks = blocksOf(message)
  const ids = changesOf(message)
  const stored = workOf(message)
  const work = stored && withoutCards(stored)
  const error = errorUnder({ work, answered: blocks.length > 0 })
  const { spec, hasSpec } = useJsonRenderMessage(message.parts)
  const paths = live ? [] : homePathsIn(blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'))
  const found = useHomeFiles({ agentId, threadId, paths })
  const plugins = found?.size ? [remarkGfm, linkHomeFiles(found)] : [remarkGfm]
  return <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
    <span className={live ? 'talking' : undefined}><Face agent={agent} size={34} /></span>
    <CopyMenu text={textOf(message)}><div className="flex min-w-0 flex-col gap-2 pt-1.5 pointer-coarse:select-none">
      {live && liveThread && <LiveTitle threadId={liveThread} />}
      {work && <WorkLine agent={agent} work={work} notes={replyOf(message.parts).notes} live={live} answered={blocks.length > 0} onRetry={onRetry} />}
      {step && !work && <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-mute" role="status">{!blocks.length && <Spinner className="mt-0 size-3.5 shrink-0" />}<span className="truncate">{step}</span></span>}
      {blocks.map((block, index) => block.type === 'text'
        ? <div key={index} className={cn('msg-t', live && index === blocks.length - 1 && 'caret')}><Markdown remarkPlugins={plugins} components={{ a: ChatLink, code: FileCode, pre: CodeBlock, input: TaskBox, table: WideTable }}>{live ? settled(bullets(block.text)) : bullets(block.text)}</Markdown></div>
        : hasSpec && <MessageCard key={index} spec={spec} loading={live} />)}
      {ids.length > 0 && <AskCards agent={agent} ids={ids} />}
      {message.parts.map((part, index) => part.type === 'data-webhook-setup' && <WebhookSetupCard key={index} agentId={agentId} card={part.data} done={said?.(doneText(part.data)) ?? false} />)}
      {message.parts.flatMap((part, index) => part.type === 'data-notified' ? part.data.map((each, at) => <NotifiedRow key={`${index}-${at}`} notified={each} />) : [])}
      {live && !blocks.length && !step && !work?.calls.some((call) => call.status === 'running') && <span className="pt-1.5" aria-label={`${agent.name} is thinking`}><Dots /></span>}
      {!live && error !== undefined && <span className="flex flex-wrap items-center gap-2 text-[13.5px] text-mute-2 italic">{error}{onRetry && <RetryButton onRetry={onRetry} />}</span>}
    </div></CopyMenu>
  </div>
}

const Authored = z.object({ author: z.string() })

function UserMessage({ message, seen }: { message: AgentMessage; seen?: string }) {
  const text = textOf(message)
  const files = message.parts.flatMap((part) => part.type === 'file' ? [part] : [])
  const author = z.safeParse(Authored, message.metadata).data?.author
  const call = callOf(message.metadata)
  const body = call ? <CallText label={call.label} text={text} /> : text
  const me = useOwner()
  if (author && me && author !== me) return <div className="flex gap-3">
    <PersonFace name={personName(author)} email={author} size={28} />
    <span className="grid min-w-0 gap-1"><span className="text-[12px] text-mute">{personName(author)}</span>
      {files.length > 0 && <span className="flex flex-wrap gap-1.5">{files.map((file) => <SentFile key={file.url} name={file.filename ?? nameOf(file.url)} path={file.url} mediaType={file.mediaType} />)}</span>}
      {call?.card && <CallCardMessage call={call} card={call.card} name={author} text={text} />}
      {text && !call?.card && <CopyMenu text={text}><span className="max-w-[420px] rounded-[4px_12px_12px_12px] bg-soft px-3.5 py-2 text-[14px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink pointer-coarse:select-none">{body}</span></CopyMenu>}
    </span>
  </div>
  return <div className="flex flex-col items-end gap-1.5">
    {files.length > 0 && <div className="flex max-w-[78%] flex-wrap justify-end gap-1.5">{files.map((file) => <SentFile key={file.url} name={file.filename ?? nameOf(file.url)} path={file.url} mediaType={file.mediaType} />)}</div>}
    {text && <CopyMenu text={text}><div className="max-w-[78%] rounded-[12px_12px_4px_12px] bg-soft px-3.5 py-2 text-[14px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink pointer-coarse:select-none">{body}</div></CopyMenu>}
    {seen && <SeenBy threadId={seen} />}
  </div>
}

function CopyMenu({ text, children }: { text: string; children: ReactElement }) {
  const touch = useMedia(TOUCH)
  if (!touch || !text) return children
  return <LongPressMenu menu={<DropdownMenuItem onClick={() => void copyText(text).then((copied) => { if (copied) toast('Copied') })}><I icon={Copy01Icon} size={16} />Copy</DropdownMenuItem>}>{children}</LongPressMenu>
}

function SentFile({ name, path, mediaType }: { name: string; path: string; mediaType: string }) {
  const { agentId, threadId, save } = useContext(ChatFiles)
  const thumb = useThumb({ agentId, threadId, path, mediaType })
  return <FileChip name={name} image={mediaType.startsWith('image/')} thumb={thumb} onOpen={() => save(path)} />
}

function FileChip({ name, image, thumb, busy, onOpen, onRemove }: { name: string; image: boolean; thumb?: string; busy?: boolean; onOpen?: () => void; onRemove?: () => void }) {
  const icon = thumb ? <img src={thumb} alt="" className="size-[18px] shrink-0 rounded-[3px] object-cover" /> : <I icon={image ? Image01Icon : File01Icon} size={14} className="shrink-0 text-mute" />
  const body = <>{busy && !thumb ? <Spinner className="mt-0 size-3" /> : icon}<span className={cn('truncate', busy && thumb && 'text-mute')}>{name}</span>{busy && thumb && <Spinner className="mt-0 size-3" />}</>
  const chip = 'inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-soft px-2 align-middle font-sans text-[12.5px] text-ink'
  if (onOpen) return <Button type="button" variant="bare" className={cn(chip, 'cursor-pointer hover:bg-mid')} title={`Save ${name}`} onClick={onOpen}>{body}</Button>
  return <span className={chip} title={name}>{body}{onRemove && <Button type="button" variant="bare" className="-mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-mute hover:text-ink" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}><I icon={Cancel01Icon} size={12} /></Button>}</span>
}

function FileCode({ children, className }: { children?: ReactNode; className?: string }) {
  const { save } = useContext(ChatFiles)
  const path = typeof children === 'string' ? homeFile(children) : undefined
  if (path) return <FileChip name={nameOf(path)} image={IMAGE.test(path)} onOpen={() => save(path)} />
  return <code className={className}>{children}</code>
}

function WideTable({ children }: { children?: ReactNode }) {
  return <div className="table-scroll"><table>{children}</table></div>
}

function TaskBox({ checked }: { checked?: boolean }) {
  return <span className={cn('task-box', checked && 'done')} role="img" aria-label={checked ? 'Done' : 'Not done'}>{checked && ICONS.check}</span>
}

function homeFile(text: string) {
  const path = text.trim()
  return !path.includes('\n') && /\.[A-Za-z0-9]{1,10}$/.test(path) && fileInHome(path) !== undefined ? path : undefined
}

function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

type Block = { type: 'text'; text: string } | { type: 'card' }

function blocksOf(message: AgentMessage): Block[] {
  const blocks: Block[] = []
  for (const part of replyOf(message.parts).reply) {
    if (part.type === 'data-spec' && !blocks.some((block) => block.type === 'card')) blocks.push({ type: 'card' })
    if (part.type === 'text' && part.text) blocks.push({ type: 'text', text: part.text })
  }
  return blocks
}

function workOf(message: AgentMessage): Work | undefined {
  const work = message.parts.filter((part) => part.type === 'data-work').at(-1)
  if (work) return work.data
  return legacyWork({ events: message.parts.flatMap((part) => part.type === 'data-tool' ? [part.data] : []), calls: message.parts.flatMap((part) => part.type === 'data-calls' ? part.data : []) })
}

export function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { save } = useContext(ChatFiles)
  const path = href === undefined ? undefined : homeFile(href)
  if (path) return <FileChip name={nameOf(path)} image={IMAGE.test(path)} onOpen={() => save(path)} />
  const bare = href !== undefined && children === href && /^https?:\/\//.test(href)
  return <a href={href} target="_blank" rel="noreferrer">{bare ? shortUrl(href) : children}{bare && <I icon={ArrowUpRight01Icon} size={12} className="ml-0.5 inline align-[-1px] text-mute" />}</a>
}

function shortUrl(href: string) {
  const short = href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return short.length > 40 ? `${short.slice(0, 38)}…` : short
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

function changesOf(message: AgentMessage): string[] {
  return message.parts.flatMap((part) => part.type === 'data-asks' ? part.data : [])
}

function uiMessageOf(message: ChatMessage): AgentMessage {
  return { id: message.id, role: message.role, metadata: message.metadata, parts: message.parts.flatMap((part): AgentPart[] => {
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (part.type === 'data-tool') return [{ type: 'data-tool', data: z.safeParse(ToolProgress, part.data).data ?? {} }]
    if (part.type === 'data-work') return z.safeParse(Work, part.data).data ? [{ type: 'data-work', id: 'work', data: z.parse(Work, part.data) }] : []
    if (part.type === 'data-calls') return [{ type: 'data-calls', data: z.safeParse(z.array(ChatCall), part.data).data ?? [] }]
    if (part.type === 'data-asks' || part.type === 'data-changes') return [{ type: 'data-asks', data: z.safeParse(z.array(z.string()), part.data).data ?? [] }]
    if (part.type === 'data-webhook-setup') return z.safeParse(WebhookSetup, part.data).data ? [{ type: 'data-webhook-setup', data: z.parse(WebhookSetup, part.data) }] : []
    if (part.type === 'data-notified') return z.safeParse(Notified, part.data).data ? [{ type: 'data-notified', data: z.parse(Notified, part.data) }] : []
    if (part.type === 'data-spec') return [{ type: 'data-spec', data: part.data as SpecDataPart }]
    if (part.type === 'data-step') return [{ type: 'data-step', data: {} }]
    if (part.type === 'file' && typeof part.url === 'string' && typeof part.mediaType === 'string') return [{ type: 'file', url: part.url, mediaType: part.mediaType, filename: typeof part.filename === 'string' ? part.filename : undefined }]
    return []
  }) }
}

function textOf(message: AgentMessage) {
  return replyText(message.parts)
}
