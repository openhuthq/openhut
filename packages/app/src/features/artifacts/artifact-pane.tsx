import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { ArrowExpand01Icon, ArrowLeft01Icon, ArrowShrink01Icon, Cancel01Icon, Copy01Icon, Delete02Icon, LinkSquare02Icon, MoreHorizontalIcon, Share03Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CopyButton } from '@/components/copy-button'
import { ConfirmPills, useConfirming } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { PersonFace } from '@/components/custom/person-face'
import { I } from '@/components/kit'
import { Face } from '@/features/agents/face'
import { usePeople } from '@/features/people/api'
import { ChatMarkdown } from '@/features/threads/chat'
import { request, RequestError } from '@/lib/api-client'
import { openhut } from '@/lib/openhut'
import { copyText } from '@/lib/clipboard'
import { personName } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ACCESS_WORD, ArtifactView, DOCK_FROM, keptSrc, paneWidth, sizeOf, type ArtifactAccess, type ShownSrc } from '@/features/artifacts/artifact'
import { ACCESS_ICON, artifactKey, fetchArtifact, KindTile, retryUnlessGone } from '@/features/artifacts/artifact-card'

const SPLIT_KEY = 'openhut.artifactSplit'
const STEP = 24
const HEAD_ICON = 'grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0 text-ink hover:bg-soft data-popup-open:bg-soft'
const NOTE: Record<ArtifactAccess, string> = {
  private: 'Only the people above can open it.',
  team: 'Anyone in your team can view it.',
  link: 'Anyone with the link can view it. No sign-in.',
}

export function ArtifactDock({ agent, artifactId, row, enlarged, onEnlarge, onClose }: { agent: Agent; artifactId: string; row: HTMLElement | null; enlarged: boolean; onEnlarge: (enlarged: boolean) => void; onClose: () => void }) {
  const split = useSplit(row)
  const sheet = split.total > 0 && split.total < DOCK_FROM
  useEffect(() => { if (sheet) onEnlarge(false) }, [sheet, onEnlarge])
  useEffect(() => {
    if (!enlarged) return
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role=dialog], [role=menu]')) return
      event.stopImmediatePropagation()
      onEnlarge(false)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [enlarged, onEnlarge])
  if (!split.total) return null
  if (enlarged && !sheet) return <section aria-label="Artifact" className="flex min-w-0 flex-1 flex-col bg-card">
    <ArtifactPane agent={agent} artifactId={artifactId} enlarged onEnlarge={onEnlarge} onClose={onClose} />
  </section>
  if (sheet) return <Dialog size="window" label="Artifact" onClose={onClose}>
    <ArtifactPane agent={agent} artifactId={artifactId} sheet onClose={onClose} />
  </Dialog>
  const width = paneWidth({ total: split.total, fraction: split.fraction })
  return <>
    <div role="separator" aria-orientation="vertical" aria-label="Resize" aria-valuenow={Math.round(width / split.total * 100)} tabIndex={0} data-dragging={split.dragging || undefined}
      className="group/divider relative z-10 -mx-1 w-[9px] shrink-0 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-hair after:transition-[background,width,left] hover:after:left-[3.5px] hover:after:w-0.5 hover:after:bg-mid focus-visible:after:left-[3.5px] focus-visible:after:w-0.5 focus-visible:after:bg-ink data-dragging:after:left-[3.5px] data-dragging:after:w-0.5 data-dragging:after:bg-ink"
      {...split.handlers(width)}>
      {split.dragging && <span className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-1/2 rounded-md bg-ink px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-white">{width} px</span>}
    </div>
    <section aria-label="Artifact" className="flex w-(--pw) shrink-0 flex-col bg-card" style={{ '--pw': `${width}px` } as CSSProperties}>
      <ArtifactPane agent={agent} artifactId={artifactId} still={split.dragging} enlarged={false} onEnlarge={onEnlarge} onClose={onClose} />
    </section>
  </>
}

function useSplit(row: HTMLElement | null) {
  const [total, setTotal] = useState(0)
  const [fraction, setFraction] = useState(savedFraction)
  const [drag, setDrag] = useState<{ x: number; width: number }>()
  useLayoutEffect(() => {
    if (!row) return
    setTotal(row.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => { if (entry) setTotal(entry.contentRect.width) })
    observer.observe(row)
    return () => observer.disconnect()
  }, [row])
  useEffect(() => { if (total < DOCK_FROM) setDrag(undefined) }, [total])
  const set = (width: number, save = true) => {
    const next = paneWidth({ total, fraction: width / total }) / total
    setFraction(next)
    if (save) saveFraction(next)
    return next
  }
  const handlers = (width: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ x: event.clientX, width })
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) set(drag.width - (event.clientX - drag.x), false)
    },
    onPointerUp: () => { setDrag(undefined); saveFraction(fraction) },
    onPointerCancel: () => { setDrag(undefined); saveFraction(fraction) },
    onLostPointerCapture: () => setDrag(undefined),
    onDoubleClick: () => set(total / 2),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      set(width + (event.key === 'ArrowLeft' ? STEP : -STEP))
    },
  })
  return { total, fraction, dragging: !!drag, handlers }
}

function savedFraction() {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY))
    return saved > 0 && saved < 1 ? saved : 0.5
  } catch { return 0.5 }
}

function saveFraction(fraction: number) {
  try { localStorage.setItem(SPLIT_KEY, String(fraction)) } catch { return }
}

function ArtifactPane({ agent, artifactId, sheet, still, enlarged, onEnlarge, onClose }: { agent: Agent; artifactId: string; sheet?: boolean; still?: boolean; enlarged?: boolean; onEnlarge?: (enlarged: boolean) => void; onClose: () => void }) {
  const view = useQuery({ queryKey: artifactKey(artifactId), queryFn: () => fetchArtifact(artifactId), retry: retryUnlessGone })
  const client = useQueryClient()
  const { confirming, setConfirming, box } = useConfirming()
  const remove = useMutation({
    mutationFn: () => request({ schema: z.null(), path: `/api/artifacts/${encodeURIComponent(artifactId)}`, method: 'DELETE' }),
    onSuccess: () => { client.removeQueries({ queryKey: artifactKey(artifactId) }); onClose() },
    onError: toastError,
  })
  const data = view.data
  const close = <Button type="button" size="icon" className="text-ink" aria-label="Close" title="Close" onClick={onClose}><I icon={Cancel01Icon} size={16} /></Button>
  const gone = view.error instanceof RequestError && view.error.status === 404
  const actions = confirming
    ? <ConfirmPills box={box} question="Delete for everyone?" action="Delete" danger busy={remove.isPending} onCancel={() => setConfirming(false)} onConfirm={() => remove.mutate()} />
    : <>
      {data?.canManage && <SharePopover key={data.id} agent={agent} view={data} icon={sheet} />}
      {data && <MoreMenu key={data.id} view={data} onDelete={() => setConfirming(true)} />}
      {onEnlarge && data && <Button type="button" size="icon" className="text-ink" aria-label={enlarged ? 'Shrink' : 'Enlarge'} title={enlarged ? 'Shrink' : 'Enlarge'} onClick={() => onEnlarge(!enlarged)}><I icon={enlarged ? ArrowShrink01Icon : ArrowExpand01Icon} size={16} /></Button>}
      {!sheet && close}
    </>
  return <div className="flex min-h-0 w-full flex-1 flex-col bg-card">
    <header className={cn('flex h-[52px] shrink-0 items-center gap-2 border-b border-hair', sheet ? 'px-2' : 'pr-2.5 pl-4')}>
      {sheet && <Button type="button" size="icon" className="text-ink" aria-label="Back" title="Back" onClick={onClose}><I icon={ArrowLeft01Icon} size={18} /></Button>}
      {data && !sheet && <KindTile kind={data.kind} title={data.title} small />}
      <span className="min-w-0 truncate font-medium">{data?.title}</span>
      {data && <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-soft py-0.5 pr-2 pl-[7px] text-[12px] text-mute"><I icon={ACCESS_ICON[data.access]} size={11} />{ACCESS_WORD[data.access]}</span>}
      <span className="flex-1" />
      {actions}
    </header>
    <div className={cn('relative min-h-0 flex-1 overflow-hidden', still && 'pointer-events-none')}>
      {data ? <Viewer view={data} /> : <div className="grid size-full place-items-center">{gone ? <p className="m-0 p-6 text-center text-mute">This was deleted, or you can’t open it.</p> : <ErrorNote message={view.error?.message} />}</div>}
    </div>
  </div>
}

export function Viewer({ view }: { view: Pick<ArtifactView, 'id' | 'kind' | 'src' | 'title'> & { ver?: number; size?: number } }) {
  const kept = useRef<ShownSrc>(undefined)
  kept.current = keptSrc({ kept: kept.current, key: `${view.id}:${view.ver ?? ''}`, src: view.src, now: Date.now() })
  const src = kept.current.src
  switch (view.kind) {
    case 'page': return <iframe title={view.title} src={src} sandbox="allow-scripts allow-forms allow-popups allow-modals" referrerPolicy="no-referrer" className="block size-full border-0 bg-card" />
    case 'pdf': return <iframe title={view.title} src={src} referrerPolicy="no-referrer" className="block size-full border-0 bg-card" />
    case 'image': return <div className="grid size-full place-items-center overflow-auto p-4"><img src={src} alt={view.title} className="max-h-full max-w-full rounded-lg object-contain" /></div>
    case 'md': return <Notes src={src} />
    case 'file': return <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
      <KindTile kind="file" title={view.title} large />
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] break-all text-ink">{view.title}</span>
        {view.size !== undefined && <span className="text-[13px] text-mute">{sizeOf(view.size)}</span>}
      </div>
      <a href={src} download={view.title} className={buttonVariants({ variant: 'secondary' })}>Download</a>
    </div>
  }
}

function Notes({ src }: { src: string }) {
  const text = useQuery({ queryKey: ['artifact-text', src], queryFn: async () => {
    const response = await openhut.fetch({ path: src })
    if (!response.ok) throw new Error('These notes didn’t load. Try again.')
    return response.text()
  } })
  return <div className="size-full overflow-auto px-7 py-6">
    {text.data !== undefined ? <div className="mx-auto max-w-[720px]"><ChatMarkdown text={text.data} /></div> : <ErrorNote message={text.error?.message} />}
  </div>
}

function MoreMenu({ view, onDelete }: { view: ArtifactView; onDelete: () => void }) {
  const link = view.shareUrl ? `${location.origin}${view.shareUrl}` : location.href
  const copy = () => copyText(link).then((ok) => { if (ok) toast('Link copied') })
  return <DropdownMenu>
    <DropdownMenuTrigger className={HEAD_ICON} aria-label="More" title="More"><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-[200px]">
      <DropdownMenuItem onClick={() => window.open(view.src, '_blank', 'noopener')}><I icon={LinkSquare02Icon} size={15} />Open in new tab</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void copy()}><I icon={Copy01Icon} size={15} />Copy link</DropdownMenuItem>
      {view.canManage && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}><I icon={Delete02Icon} size={15} />Delete</DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}

function SharePopover({ agent, view, icon }: { agent: Agent; view: ArtifactView; icon?: boolean }) {
  const client = useQueryClient()
  const people = usePeople().data ?? []
  const [missing, setMissing] = useState<string>()
  const path = `/api/artifacts/${encodeURIComponent(view.id)}`
  const save = (next: ArtifactView) => client.setQueryData(artifactKey(view.id), next)
  const update = useMutation({ mutationFn: (body: { access?: ArtifactAccess; add?: string[]; remove?: string[] }) => request({ schema: ArtifactView, path, method: 'PATCH', body }), onSuccess: save, onError: toastError })
  const reset = useMutation({ mutationFn: () => request({ schema: ArtifactView, path: `${path}/link`, method: 'POST' }), onSuccess: save, onError: toastError })
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const field = event.currentTarget.elements.namedItem('person')
    if (!(field instanceof HTMLInputElement)) return
    const typed = field.value.trim()
    if (!typed) return
    const email = typed.includes('@') ? typed : people.find((person) => person.name.toLowerCase().startsWith(typed.toLowerCase()))?.email
    if (!email) return setMissing('No one in your team by that name. Try their email.')
    setMissing(undefined)
    update.mutate({ add: [email] }, { onSuccess: () => { field.value = '' } })
  }
  const nameOf = (email: string) => people.find((person) => person.email === email)?.name ?? personName(email)
  const shown = view.shareUrl && `${location.host}${view.shareUrl}`
  return <Popover>
    <PopoverTrigger className={icon ? HEAD_ICON : cn(buttonVariants(), 'px-2.5 data-popup-open:bg-soft')} aria-label="Share" title={icon ? 'Share' : undefined}><I icon={Share03Icon} size={16} />{!icon && 'Share'}</PopoverTrigger>
    <PopoverContent className="w-[384px] gap-3 rounded-2xl pb-3.5">
      <span className="text-[12px] text-mute">People with access</span>
      <form onSubmit={add} className="flex flex-col gap-1">
        <Input name="person" placeholder="Add people by name or email" autoComplete="off" className="border-0 bg-sidebar px-2.5 text-[13px]" disabled={update.isPending} />
        {missing && <span role="alert" className="text-[12px] text-fail">{missing}</span>}
      </form>
      <div className="flex min-h-9 items-center gap-2.5">
        <Face agent={agent} size={28} />
        <span className="flex min-w-0 flex-1 flex-col leading-[1.3]"><span className="truncate">Everyone who can use {agent.name}</span><small className="text-[12px] text-mute">From the agent’s access</small></span>
        <span className="text-[12px] text-mute">Owners</span>
      </div>
      {view.people.map((email) => <div key={email} className="flex min-h-9 items-center gap-2.5">
        <PersonFace name={nameOf(email)} email={email} size={28} />
        <span className="flex min-w-0 flex-1 flex-col leading-[1.3]"><span className="truncate">{nameOf(email)}</span><small className="truncate text-[12px] text-mute">{email}</small></span>
        <span className="text-[12px] text-mute">Can view</span>
        <Button type="button" size="icon-sm" aria-label={`Remove ${email}`} title="Remove" disabled={update.isPending} onClick={() => update.mutate({ remove: [email] })}><I icon={Cancel01Icon} size={14} /></Button>
      </div>)}
      <div role="separator" className="my-0.5 h-px bg-hair" />
      <span className="text-[12px] text-mute">General access</span>
      <ToggleGroup variant="segmented" value={view.access} onPick={(access) => update.mutate({ access: access as ArtifactAccess })} aria-label="General access" className="grid grid-cols-3 rounded-[10px] p-[3px]">
        {(['private', 'team', 'link'] as const).map((access) => <ToggleGroupItem key={access} value={access} className="h-[30px] justify-center rounded-lg text-[13px] whitespace-nowrap">{ACCESS_WORD[access]}</ToggleGroupItem>)}
      </ToggleGroup>
      <span className="text-[13px] text-mute">{NOTE[view.access]}</span>
      {view.shareUrl && <>
        <div className="flex items-center gap-1.5">
          <span className="flex h-8 min-w-0 flex-1 items-center truncate rounded-lg bg-sidebar px-2.5 font-mono text-[12px] text-body">{shown}</span>
          <CopyButton text={`${location.origin}${view.shareUrl}`} label="Copy" size="default" />
        </div>
        <Button type="button" variant="text" className="self-start text-[13px]" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset link</Button>
      </>}
    </PopoverContent>
  </Popover>
}
