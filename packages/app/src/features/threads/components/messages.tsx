import { createContext, lazy, Suspense, useContext, type ReactElement, type ReactNode, type ComponentType } from 'react'
import * as z from 'zod/mini'
import type { UIMessage } from 'ai'
import Markdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SpecDataPart } from '@json-render/core'
import { useJsonRenderMessage } from '@json-render/react'
import { ArrowUpRight01Icon, Copy01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChatCall, fileInHome, ToolProgress, Work, type ChatMessage } from '@openhut/common/threads/thread.ts'
import { DropdownMenuItem, LongPressMenu } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Dots, I } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { useOwner } from '@/lib/queries/people'
import { personName } from '@/lib/format'
import { Face } from '@/components/agent-face'
import { useHomeFiles, useThumb } from '@/features/threads/api/threads'
import { replyOf, replyText } from '@openhut/common/threads/reply.ts'
import { Notified, placeName, type SourcedThread } from '@/lib/places'
import { PlaceIcon } from '@/components/place-icon'
import { doneText, WebhookSetup, WebhookSetupCard } from '@/features/threads/components/webhook-setup-card'
import { homePathsIn, linkHomeFiles } from '@/features/threads/files'
import { errorUnder, legacyWork, withoutCards } from '@/features/threads/steps'
import { RetryButton, WorkLine } from '@/features/threads/components/work'
import { MessageCard } from '@/features/threads/components/card'
import { bullets, settled } from '@/features/threads/markdown'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { TOUCH, useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'
import { ICONS } from '@/components/icons'
import { LiveTitle, SeenBy } from '@/features/threads/components/live'
import { CallText, webhookOf, WebhookMessage } from '@/features/threads/components/webhook-message'
import { callOf } from '@/lib/webhook-call'
import { CallCardMessage } from '@/components/call-card'
import { FileChip } from '@/features/threads/components/file-drop'

export type AgentMessage = UIMessage<unknown, { tool: ToolProgress; calls: ChatCall[]; work: Work; spec: SpecDataPart; asks: string[]; notified: Notified; 'webhook-setup': WebhookSetup; artifact: unknown; step: Record<string, never> }>
type AgentPart = AgentMessage['parts'][number]

export const ChatFiles = createContext<{ agentId: string; threadId: string; save: (path: string) => void }>({ agentId: '', threadId: '', save: () => undefined })

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

const CodeBlock = lazy(() => import('@/features/threads/components/code').then((module) => ({ default: module.CodeBlock })))

export type AskSlots = { Cards: ComponentType<{ agent: Agent; ids: string[] }>; Pending: ComponentType<{ agent: Agent; shown: Set<string> }> }

export const ChatAsks = createContext<AskSlots>({ Cards: () => null, Pending: () => null })

export const ChatParts = createContext<{ Artifact: ComponentType<{ agentId: string; threadId: string; data: unknown }> }>({ Artifact: () => null })

function NotifiedRow({ notified }: { notified: Notified[number] }) {
  return <span className="inline-flex items-center gap-1.5 text-[12.5px] text-mute" title={notified.text}><PlaceIcon platform={notified.place.platform} size={12} />Notified {placeName(notified.place)}</span>
}

export function Day({ iso }: { iso: string }) {
  const date = new Date(iso)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })
  return <div className="flex items-center gap-3 text-[11.5px] text-mute-2"><span className="h-px flex-1 bg-hair" />{label}<span className="h-px flex-1 bg-hair" /></div>
}

export function Message({ agent, thread, message, said, seen, live, onRetry }: { agent: Agent; thread: SourcedThread; message: AgentMessage; said: (text: string) => boolean; seen: boolean; live: boolean; onRetry?: () => void }) {
  const webhook = webhookOf(message.metadata)
  if (webhook && !callOf(message.metadata) && message.role === 'user') return <WebhookMessage webhook={webhook} at={thread.createdAt} />
  return message.role === 'user' ? <UserMessage message={message} seen={seen ? thread.id : undefined} /> : <AgentReply agent={agent} threadId={thread.id} message={message} said={said} live={live} onRetry={onRetry} />
}

export function AgentReply({ agent, threadId: liveThread, step, message, said, live, onRetry }: { agent: Agent; threadId?: string; step?: string; message: AgentMessage; said?: (text: string) => boolean; live: boolean; onRetry?: () => void }) {
  const { agentId, threadId } = useContext(ChatFiles)
  const asks = useContext(ChatAsks)
  const parts = useContext(ChatParts)
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
        ? <div key={index} className={cn('msg-t', live && index === blocks.length - 1 && 'caret')}><Markdown remarkPlugins={plugins} components={{ a: ChatLink, code: FileCode, pre: Code, input: TaskBox, table: WideTable }}>{live ? settled(bullets(block.text)) : bullets(block.text)}</Markdown></div>
        : hasSpec && <MessageCard key={index} spec={spec} loading={live} />)}
      {ids.length > 0 && <asks.Cards agent={agent} ids={ids} />}
      {message.parts.map((part, index) => part.type === 'data-webhook-setup' && <WebhookSetupCard key={index} agentId={agentId} card={part.data} done={said?.(doneText(part.data)) ?? false} />)}
      {message.parts.map((part, index) => part.type === 'data-artifact' && <parts.Artifact key={index} agentId={agentId} threadId={threadId} data={part.data} />)}
      {message.parts.flatMap((part, index) => part.type === 'data-notified' ? part.data.map((each, at) => <NotifiedRow key={`${index}-${at}`} notified={each} />) : [])}
      {live && !blocks.length && !step && !work?.calls.some((call) => call.status === 'running') && <span className="pt-1.5" aria-label={`${agent.name} is thinking`}><Dots /></span>}
      {!live && error !== undefined && <span className="flex flex-wrap items-center gap-2 text-[13.5px] text-mute-2 italic">{error}{onRetry && <RetryButton onRetry={onRetry} />}</span>}
    </div></CopyMenu>
  </div>
}

export const Authored = z.object({ author: z.string() })

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

export function workOf(message: AgentMessage): Work | undefined {
  const work = message.parts.filter((part) => part.type === 'data-work').at(-1)
  if (work) return work.data
  return legacyWork({ events: message.parts.flatMap((part) => part.type === 'data-tool' ? [part.data] : []), calls: message.parts.flatMap((part) => part.type === 'data-calls' ? part.data : []) })
}

export function ChatMarkdown({ text }: { text: string }) {
  return <div className="msg-t doc"><Markdown remarkPlugins={[remarkGfm]} components={{ a: OutLink, pre: Code, input: TaskBox, table: WideTable }}>{bullets(text)}</Markdown></div>
}

function OutLink({ href, children }: { href?: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
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

export function changesOf(message: AgentMessage): string[] {
  return message.parts.flatMap((part) => part.type === 'data-asks' ? part.data : [])
}

export function uiMessageOf(message: ChatMessage): AgentMessage {
  return { id: message.id, role: message.role, metadata: message.metadata, parts: message.parts.flatMap((part): AgentPart[] => {
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (part.type === 'data-tool') return [{ type: 'data-tool', data: z.safeParse(ToolProgress, part.data).data ?? {} }]
    if (part.type === 'data-work') return z.safeParse(Work, part.data).data ? [{ type: 'data-work', id: 'work', data: z.parse(Work, part.data) }] : []
    if (part.type === 'data-calls') return [{ type: 'data-calls', data: z.safeParse(z.array(ChatCall), part.data).data ?? [] }]
    if (part.type === 'data-asks' || part.type === 'data-changes') return [{ type: 'data-asks', data: z.safeParse(z.array(z.string()), part.data).data ?? [] }]
    if (part.type === 'data-webhook-setup') return z.safeParse(WebhookSetup, part.data).data ? [{ type: 'data-webhook-setup', data: z.parse(WebhookSetup, part.data) }] : []
    if (part.type === 'data-artifact') return [{ type: 'data-artifact', data: part.data }]
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

function Code({ node, children }: ExtraProps & { children?: ReactNode }) {
  return <Suspense fallback={<pre>{children}</pre>}><CodeBlock node={node} /></Suspense>
}
