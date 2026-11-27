import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp02Icon, Attachment01Icon, EraserIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Alert } from '@/components/ui/alert'
import { Tooltip } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { HINT, I, ICON_BUTTON } from '@/components/kit'
import { agentState } from '@/components/status-badge'
import { useClearChat } from '@/features/threads/api'
import { TOUCH, useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'
import { useTyping } from '@/lib/thread-live'
import { PresenceFaces } from '@/features/threads/live'
import { FileChip, type Attachments } from '@/features/threads/file-drop'

export function ComposerSkeleton() {
  return <div className="shrink-0 px-8 pb-5 transition-[padding] group-data-[threads]/chat:pr-[396px] phone:px-3 phone:pb-3"><div className="mx-auto h-[108px] max-w-[840px] rounded-[22px] border border-hair bg-sidebar" /></div>
}

export function Composer({ agent, threadId, busy, quiet, attachments, clear, onSend, onStop }: { agent: Agent; threadId: string; busy: boolean; quiet: boolean; attachments: Attachments; clear?: ReactNode; onSend: (text: string) => void; onStop: () => void }) {
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

export function ClearChat({ agent, threadId, attachments, disabled }: { agent: Agent; threadId: string; attachments: Attachments; disabled: boolean }) {
  const clearChat = useClearChat({ agentId: agent.id, threadId })
  const uploads = attachments.items.flatMap((item) => item.file ? [item.file.path] : [])
  const [asking, setAsking] = useState(false)
  return <>
    <Tooltip label="Clear chat"><Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Clear chat" disabled={disabled} onClick={() => setAsking(true)}><I icon={EraserIcon} size={16} /></Button></Tooltip>
    <ConfirmDialog open={asking} onOpenChange={setAsking} question="Clear this chat?" detail="Memory stays. Files you sent are deleted." action="Clear"
      onConfirm={() => clearChat.mutateAsync({ uploads }).then(() => attachments.clear())} />
  </>
}
