import { createContext, useContext, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { asked } from '@/features/connections/asked'
import { AGENTS_KEY } from '@/lib/query-keys'
import { usePath } from '@/lib/router'
import { DefaultChatTransport, type UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SpecDataPart } from '@json-render/core'
import { useJsonRenderMessage } from '@json-render/react'
import { ArrowLeft01Icon, ArrowUp02Icon, Attachment01Icon, Cancel01Icon, Copy01Icon, EraserIcon, File01Icon, Image01Icon, PlayIcon, PlusSignIcon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@openhut/client'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChatCall, fileInHome, MAX_FILE_BYTES, MAX_FILES, ToolProgress, type ChatFile, type ChatMessage, type ThreadWithMessages } from '@openhut/common/threads/thread.ts'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, LongPressMenu } from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { STEP_ICONS } from '@/components/icons'
import { DRAG, Dots, I, ICON_BUTTON } from '@/components/kit'
import { OfflineChip } from '@/features/cloud/live'
import { Faces, typed, Typing } from '@/features/cloud/presence'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf as personName, useCloud } from '@/features/cloud/api'
import { SidebarContext } from '@/features/agents/sidebar'
import { agentState } from '@/components/status-badge'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { deleteUpload, saveFile, threadPath, uploadFile, useAgentThread, useClearChat, useHomeFiles, useThumb, useTouchThread } from '@/features/threads/api'
import { homePathsIn, linkHomeFiles, RASTER } from '@/features/threads/files'
import { ConfirmIcon } from '@/components/confirm-button'
import { attachCalls, kindOf, stepsOf, type Step } from '@/features/threads/steps'
import { CardReply, MessageCard } from '@/features/threads/card'
import { ChangeCards, PendingElsewhere } from '@/features/agents/change-requests'
import { copyText } from '@/lib/clipboard'
import { openhut } from '@/lib/openhut'
import { toast, toastError } from '@/lib/toast'
import { usePhoneBack } from '@/app/phone-page'
import { TOUCH, useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'

type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[]; spec: SpecDataPart; changes: string[] }>
type AgentPart = AgentMessage['parts'][number]
type Attachment = { key: string; name: string; image: boolean; thumb?: string; file?: ChatFile }

const ChatFiles = createContext<{ agentId: string; threadId: string; save: (path: string) => void }>({ agentId: '', threadId: '', save: () => undefined })
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export function Chat({ agent, tools, onTitle }: { agent: Agent; tools?: ReactNode; onTitle?: () => void }) {
  const thread = useAgentThread(agent.id)
  if (agentState(agent) === 'stopped') return <ChatFrame agent={agent} tools={tools} onTitle={onTitle}><Asleep agent={agent} /></ChatFrame>
  if (!thread.data) return <ChatFrame agent={agent} tools={tools} onTitle={onTitle}><div className="m-auto"><ErrorNote message={thread.error?.message} /></div></ChatFrame>
  return <ThreadView key={thread.data.id} thread={thread.data} agent={agent} tools={tools} onTitle={onTitle} />
}

function ThreadView({ thread, agent, tools, onTitle }: { thread: ThreadWithMessages; agent: Agent; tools: ReactNode; onTitle?: () => void }) {
  const touch = useTouchThread()
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: `${threadPath(thread.id)}/chat`,
    fetch: (url, init) => openhut.fetch({ of: agent.id, path: String(url), init }),
    prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { trigger, message: trigger === 'submit-message' ? messages.at(-1) : undefined } }),
  }), [thread.id, agent.id])
  const chat = useChat<AgentMessage>({ id: thread.id, messages: thread.messages.map(uiMessageOf), transport, onFinish: () => touch(thread) })
  const attachments = useAttachments({ agentId: agent.id, threadId: thread.id })
  const files = useMemo(() => ({ agentId: agent.id, threadId: thread.id, save: (path: string) => void saveFile({ agentId: agent.id, threadId: thread.id, path }).catch(toastError) }), [agent.id, thread.id])
  const busy = chat.status === 'submitted' || chat.status === 'streaming'
  useEffect(() => { if (!busy) chat.setMessages(thread.messages.map(uiMessageOf)) }, [thread.messages])
  const send = (text: string) => {
    touch(thread)
    const files = attachments.items.flatMap(({ file }) => file ? [{ type: 'file' as const, mediaType: file.mediaType, filename: file.name, url: file.path }] : [])
    void chat.sendMessage(files.length ? { text, files } : { text })
    attachments.clear()
  }
  const path = usePath()
  const client = useQueryClient()
  useEffect(() => {
    const line = asked.said(agent.id)
    if (!line || busy) return
    if (agent.health !== 'answering') {
      const timer = setTimeout(() => void client.invalidateQueries({ queryKey: AGENTS_KEY }), 1_500)
      return () => clearTimeout(timer)
    }
    asked.sent(agent.id)
    touch(thread)
    void chat.sendMessage({ text: line })
  }, [agent.id, agent.health, busy, path])
  const shown = agent.runsHere ? chat.messages : chat.messages.filter((message) => message.role === 'user' || message.parts.some((part) => part.type !== 'step-start'))
  const last = shown.at(-1)
  const clear = chat.messages.length > 0 && !busy && !attachments.uploading && <ClearChat agent={agent} threadId={thread.id} attachments={attachments} />
  return <ChatFiles value={files}><CardReply value={(text) => { if (!busy) send(text) }}><ChatFrame agent={agent} tools={<>{clear}{tools}</>} onTitle={onTitle} onFiles={attachments.add} composer={<Composer agent={agent} busy={busy} quiet={!chat.messages.length} attachments={attachments} onSend={send} onStop={() => void chat.stop()} />}>
    {shown.length ? <>
      <Day iso={thread.updatedAt} />
      {shown.map((message) => <Message key={message.id} agent={agent} message={message} live={busy && message === last} />)}
    </> : <ChatEmpty agent={agent} />}
    {chat.status === 'submitted' && last?.role === 'user' && <Message agent={agent} message={{ id: 'waiting', role: 'assistant', parts: [] }} live />}
    <PendingElsewhere agent={agent} shown={new Set(chat.messages.flatMap(changesOf))} />
    {!agent.runsHere && chat.status !== 'submitted' && last?.role === 'user' && <p className="m-0 text-right text-[12.5px] text-mute">{agent.runsNowhere ? `No computer runs ${agent.name} now. ${agent.canManage ? 'Run it here to get an answer.' : `Ask an admin to run ${agent.name} on their computer.`}` : `Sent to ${agent.runsOnName ?? 'your other computer'}. ${agent.name} answers when it’s on.`}</p>}
    {chat.error && <Alert variant="error-outline" role="alert"><span>{chat.error.message}</span><Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => void chat.regenerate()}>Try again</Button></Alert>}
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
      if (taken.current.size >= MAX_FILES) return toast(`Attach at most ${MAX_FILES} files to one message.`)
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name} is over ${MAX_FILE_BYTES >> 20} MB, too big to attach.`)
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

function ChatFrame({ agent, composer, tools, onTitle, onFiles, children }: { agent: Agent; composer?: ReactNode; tools?: ReactNode; onTitle?: () => void; onFiles?: (files: File[]) => void; children: ReactNode }) {
  const back = usePhoneBack()
  const log = useRef<HTMLDivElement>(null)
  const sidebar = useContext(SidebarContext)
  const pinned = useRef(true)
  useEffect(() => {
    const element = log.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  })
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (pinned.current) element.scrollTop = element.scrollHeight })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
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
    <div className={cn('still flex h-[52px] shrink-0 items-center gap-2 px-4 phone:grid phone:h-16 phone:grid-cols-[1fr_auto_1fr] phone:px-3', sidebar?.collapsed && 'pl-[84px] phone:pl-3', DRAG)}>
      {sidebar?.collapsed && <span className="mr-2 flex phone:hidden animate-[fadein_120ms_80ms_ease-out_backwards] items-center gap-0.5">
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Show sidebar" title="Show sidebar ⌘\" onClick={sidebar.expand}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="New agent" title="New agent" onClick={sidebar.newAgent}><I icon={PlusSignIcon} size={16} /></Button>
      </span>}
      <Button type="button" variant="bare" aria-label="All agents" className={cn(ICON_BUTTON, 'float hidden size-10 justify-self-start rounded-full bg-card text-ink phone:grid')} onClick={back}><I icon={ArrowLeft01Icon} size={20} /></Button>
      {onTitle
        ? <Button type="button" variant="bare" className="float flex h-10 min-w-0 items-center gap-2 rounded-full bg-card pr-4 pl-1.5 text-ink" onClick={onTitle}><Face agent={agent} size={28} /><span className="truncate text-[16px] font-semibold">{agent.name}</span></Button>
        : <><Face agent={agent} size={26} /><span className="min-w-0 truncate text-[14px] font-semibold">{agent.name}</span></>}
      <span className="float ml-auto flex items-center gap-0.5 phone:h-10 phone:justify-self-end phone:rounded-full phone:bg-card phone:px-1">{agent.shared && <span className="mr-2"><Faces agentId={agent.id} size={26} /></span>}<OfflineChip className="mr-1.5 phone:hidden" />{tools}</span>
    </div>
    <OfflineChip className="mx-auto hidden phone:flex" />
    <div ref={log} className="fade-t flex flex-1 flex-col overflow-auto px-8 py-5 phone:px-4" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
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

function Composer({ agent, busy, quiet, attachments, onSend, onStop }: { agent: Agent; busy: boolean; quiet: boolean; attachments: Attachments; onSend: (text: string) => void; onStop: () => void }) {
  const touch = useMedia(TOUCH)
  const [empty, setEmpty] = useState(true)
  const picker = useRef<HTMLInputElement>(null)
  const ready = agentState(agent) === 'running'
  const nothing = empty && !attachments.items.length
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const box = event.currentTarget.elements.namedItem('text')
    if (busy) return onStop()
    if (!(box instanceof HTMLTextAreaElement) || attachments.uploading || (!box.value.trim() && !attachments.items.length)) return
    onSend(box.value.trim())
    typed('')
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
  return <div className="shrink-0 px-8 pb-5 phone:px-3 phone:pb-3">
    {!ready && !busy && !quiet && <NotReady agent={agent} />}
    {agent.shared && <Typing agentId={agent.id} />}
    <form className="mx-auto flex max-w-[640px] flex-col gap-2 rounded-xl border border-[oklch(0%_0_0/.12)] bg-card p-2 focus-within:border-mid" onSubmit={submit}>
      {attachments.items.length > 0 && <div className="flex flex-wrap gap-1.5">{attachments.items.map((each) => <FileChip key={each.key} name={each.name} image={each.image} thumb={each.thumb} busy={!each.file} onRemove={() => attachments.remove(each.key)} />)}</div>}
      <div className="flex items-end gap-1">
        <Input ref={picker} type="file" multiple hidden onChange={(event) => { attachments.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Attach files" title="Attach files" disabled={!ready} onClick={() => picker.current?.click()}><I icon={Attachment01Icon} size={16} /></Button>
        <Textarea variant="composer" name="text" rows={1} aria-label="Message" placeholder={placeholderOf(agent)} disabled={!ready} autoFocus={!touch}
          className="min-h-0 flex-1 py-1.5 text-[14px]" onKeyDown={enter} onPaste={paste}
          onInput={(event) => { const box = event.currentTarget; setEmpty(!box.value.trim()); if (agent.shared) typed(box.value); box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 240)}px` }} />
        <Button type="submit" variant="send" onMouseDown={(event) => event.preventDefault()} className={cn(!busy && nothing && 'bg-transparent text-mute disabled:opacity-100')} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send (Enter). Shift+Enter for a new line'} disabled={!busy && (!ready || nothing || attachments.uploading)}>{busy ? <span className="size-2.5 rounded-[2px] bg-white" /> : <I icon={ArrowUp02Icon} />}</Button>
      </div>
    </form>
  </div>
}

function placeholderOf(agent: Agent) {
  const state = agentState(agent)
  if (state === 'running' || state === 'not_answering') return `Ask ${agent.name} anything…`
  if (state === 'stopped') return `${agent.name} is stopped`
  return `${agent.name} isn't ready yet`
}

function NotReady({ agent }: { agent: Agent }) {
  const state = agentState(agent)
  const reason = {
    starting: 'It\'s still starting. You can type as soon as it answers.',
    no_seat: 'Its model isn\'t connected.',
    not_answering: 'It restarts on its own. You can also stop it and start it again.',
    stopped: '',
    missing: 'It comes back by itself within 30 seconds.',
    running: '',
  }[state]
  return <Alert variant="warning" className="max-w-[640px]" role="status" title={agent.healthDetail || undefined}><b>{agent.name} isn't ready.</b> {reason} {state === 'no_seat' && <a href="/settings/models">Open Settings › Models</a>}</Alert>
}

function ClearChat({ agent, threadId, attachments }: { agent: Agent; threadId: string; attachments: Attachments }) {
  const clearChat = useClearChat(agent.id)
  const uploads = attachments.items.flatMap((item) => item.file ? [item.file.path] : [])
  return <ConfirmIcon label="Clear chat" icon={EraserIcon} question="Clear this chat? Memory stays; files you sent are deleted." action="Clear" busy={clearChat.isPending}
    onConfirm={(done) => clearChat.mutate({ threadId, uploads }, { onSuccess: () => { attachments.clear(); done() }, onError: toastError })} />
}

function useOffline(agent: Agent) {
  const home: OpenHutAgent | undefined = useAgents().data?.find((each) => each.id === agent.id)
  return home && !home.online
}

function Message({ agent, message, live }: { agent: Agent; message: AgentMessage; live: boolean }) {
  return message.role === 'user' ? <UserMessage message={message} /> : <AgentReply agent={agent} message={message} live={live} />
}

function AgentReply({ agent, message, live }: { agent: Agent; message: AgentMessage; live: boolean }) {
  const { agentId, threadId } = useContext(ChatFiles)
  const blocks = blocksOf(message)
  const { spec, hasSpec } = useJsonRenderMessage(message.parts)
  const paths = live ? [] : homePathsIn(blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'))
  const found = useHomeFiles({ agentId, threadId, paths })
  const plugins = found?.size ? [remarkGfm, linkHomeFiles(found)] : [remarkGfm]
  return <div className="grid animate-grow grid-cols-[34px_minmax(0,1fr)] gap-3">
    <span className={live ? 'talking' : undefined}><Face agent={agent} size={34} /></span>
    <CopyMenu text={textOf(message)}><div className="flex min-w-0 flex-col gap-2 pt-1.5 pointer-coarse:select-none">
      {blocks.map((block, index) => {
        if (block.type === 'text') return <div key={index} className="msg-t"><Markdown remarkPlugins={plugins} components={{ a: ChatLink, code: FileCode }}>{block.text}</Markdown></div>
        if (block.type === 'card') return hasSpec && <MessageCard key={index} spec={spec} loading={live} />
        return <Steps key={index} steps={block.steps} live={live && index === blocks.length - 1} />
      })}
      {changesOf(message).length > 0 && <ChangeCards agent={agent} ids={changesOf(message)} />}
      {live && !blocks.length && <span className="pt-1.5" aria-label={`${agent.name} is thinking`}><Dots /></span>}
      {!live && !blocks.length && <span className="text-[13.5px] text-mute-2 italic">No reply.</span>}
    </div></CopyMenu>
  </div>
}

const Authored = z.object({ author: z.string() })

function UserMessage({ message }: { message: AgentMessage }) {
  const text = textOf(message)
  const files = message.parts.flatMap((part) => part.type === 'file' ? [part] : [])
  const author = z.safeParse(Authored, message.metadata).data?.author
  const me = useCloud().data?.email
  if (author && me && author !== me) return <div className="flex animate-grow gap-3">
    <PersonFace name={personName(author)} email={author} size={28} />
    <span className="grid min-w-0 gap-1"><span className="text-[12px] text-mute">{personName(author)}</span>
      {files.length > 0 && <span className="flex flex-wrap gap-1.5">{files.map((file) => <SentFile key={file.url} name={file.filename ?? nameOf(file.url)} path={file.url} mediaType={file.mediaType} />)}</span>}
      {text && <CopyMenu text={text}><span className="max-w-[420px] rounded-[4px_12px_12px_12px] bg-soft px-3.5 py-2 text-[14px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink pointer-coarse:select-none">{text}</span></CopyMenu>}
    </span>
  </div>
  return <div className="flex animate-grow flex-col items-end gap-1.5">
    {files.length > 0 && <div className="flex max-w-[78%] flex-wrap justify-end gap-1.5">{files.map((file) => <SentFile key={file.url} name={file.filename ?? nameOf(file.url)} path={file.url} mediaType={file.mediaType} />)}</div>}
    {text && <CopyMenu text={text}><div className="max-w-[78%] rounded-[12px_12px_4px_12px] bg-soft px-3.5 py-2 text-[14px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink pointer-coarse:select-none">{text}</div></CopyMenu>}
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

function homeFile(text: string) {
  const path = text.trim()
  return !path.includes('\n') && /\.[A-Za-z0-9]{1,10}$/.test(path) && fileInHome(path) !== undefined ? path : undefined
}

function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

type Block = { type: 'text'; text: string } | { type: 'steps'; steps: Step[] } | { type: 'card' }

function blocksOf(message: AgentMessage): Block[] {
  const blocks: Block[] = []
  let events: ToolProgress[] = []
  const flush = () => {
    if (events.length) blocks.push({ type: 'steps', steps: stepsOf(events) })
    events = []
  }
  for (const part of message.parts) {
    if (part.type === 'data-tool') events.push(part.data)
    if (part.type === 'data-spec' && !blocks.some((block) => block.type === 'card')) {
      flush()
      blocks.push({ type: 'card' })
    }
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

const OUTCOME = { allowed: 'Allowed', denied: 'Blocked', failed: 'Failed' }
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
  const { save } = useContext(ChatFiles)
  const path = href === undefined ? undefined : homeFile(href)
  if (path) return <FileChip name={nameOf(path)} image={IMAGE.test(path)} onOpen={() => save(path)} />
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
    ? [`${agent.name}'s computer is offline`, 'It answers again as soon as its computer is back online.']
    : {
      running: [`Say hello to ${agent.name}`, 'Ask it anything, or tell it what its job is.'],
      starting: [`Starting ${agent.name}`, 'It takes about a minute the first time. You can type as soon as it answers.'],
      no_seat: [`${agent.name} isn't ready`, 'Connect its model under Settings › Models, then it starts answering.'],
      not_answering: [`${agent.name} isn't answering`, 'It restarts on its own. You can also stop it and start it again.'],
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
  return <Centered agent={agent} title={`${agent.name} is stopped`} line="It won't answer here or on its channels until you start it. Its memory and chats are kept." dim>
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

function changesOf(message: AgentMessage): string[] {
  return message.parts.flatMap((part) => part.type === 'data-changes' ? part.data : [])
}

function uiMessageOf(message: ChatMessage): AgentMessage {
  return { id: message.id, role: message.role, metadata: message.metadata, parts: message.parts.flatMap((part): AgentPart[] => {
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (part.type === 'data-tool') return [{ type: 'data-tool', data: z.safeParse(ToolProgress, part.data).data ?? {} }]
    if (part.type === 'data-calls') return [{ type: 'data-calls', data: z.safeParse(z.array(ChatCall), part.data).data ?? [] }]
    if (part.type === 'data-changes') return [{ type: 'data-changes', data: z.safeParse(z.array(z.string()), part.data).data ?? [] }]
    if (part.type === 'data-spec') return [{ type: 'data-spec', data: part.data as SpecDataPart }]
    if (part.type === 'file' && typeof part.url === 'string' && typeof part.mediaType === 'string') return [{ type: 'file', url: part.url, mediaType: part.mediaType, filename: typeof part.filename === 'string' ? part.filename : undefined }]
    return []
  }) }
}

function textOf(message: AgentMessage) {
  return message.parts.map((part) => part.type === 'text' ? part.text : '').join('')
}
