import type { MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight01Icon, BrowserIcon, Download04Icon, File01Icon, File02Icon, GridTableIcon, Image01Icon, Link01Icon, SquareLock02Icon, TextAlignLeftIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { artifactPath } from '@/app/routes'
import { request, RequestError } from '@/lib/api-client'
import { PHONE } from '@/lib/media'
import { toastError } from '@/lib/toast'
import { usePath } from '@/lib/router'
import { cn } from '@/lib/utils'
import { ArtifactView, metaOf, type ArtifactAccess, type ArtifactCard, type ArtifactKind } from '@/features/artifacts/artifact'

const KIND: Record<ArtifactKind, { icon: IconSvgElement; tone: string }> = {
  page: { icon: BrowserIcon, tone: 'text-[oklch(57%_.14_255)] bg-[color-mix(in_oklch,oklch(57%_.14_255)_13%,#fff)]' },
  pdf: { icon: File02Icon, tone: 'text-[oklch(58%_.17_27)] bg-[color-mix(in_oklch,oklch(58%_.17_27)_13%,#fff)]' },
  image: { icon: Image01Icon, tone: 'text-[oklch(55%_.15_295)] bg-[color-mix(in_oklch,oklch(55%_.15_295)_13%,#fff)]' },
  md: { icon: TextAlignLeftIcon, tone: 'text-[oklch(50%_.03_255)] bg-[color-mix(in_oklch,oklch(50%_.03_255)_13%,#fff)]' },
  file: { icon: File01Icon, tone: 'text-[oklch(56%_.13_150)] bg-[color-mix(in_oklch,oklch(56%_.13_150)_13%,#fff)]' },
}

export const ACCESS_ICON: Record<ArtifactAccess, IconSvgElement> = { private: SquareLock02Icon, team: UserMultipleIcon, link: Link01Icon }

export const artifactKey = (id: string) => ['artifacts', id]

export function fetchArtifact(id: string) {
  return request({ schema: ArtifactView, path: `/api/artifacts/${encodeURIComponent(id)}` })
}

export const retryUnlessGone = (count: number, error: Error) => !(error instanceof RequestError && error.status === 404) && count < 2

export function kindIcon({ kind, title }: { kind: ArtifactKind; title: string }) {
  return kind === 'file' && /\.(csv|tsv|xlsx?)$/i.test(title) ? GridTableIcon : KIND[kind].icon
}

export function KindTile({ kind, title, small, large }: { kind: ArtifactKind; title: string; small?: boolean; large?: boolean }) {
  const icon = kindIcon({ kind, title })
  return <span className={cn('grid shrink-0 place-items-center', small && 'size-[22px] rounded-md', large && 'size-10 rounded-[10px]', !small && !large && 'size-9 rounded-[9px]', KIND[kind].tone)}><I icon={icon} size={small ? 13 : 18} /></span>
}

export function ArtifactCardLink({ agentId, threadId, card }: { agentId: string; threadId: string; card: ArtifactCard }) {
  const client = useQueryClient()
  const known = useQuery({ queryKey: artifactKey(card.id), queryFn: () => fetchArtifact(card.id), enabled: false }).data
  const shown = { ...card, title: known?.title ?? card.title, access: known?.access ?? card.access }
  const href = artifactPath({ agentId, threadId, artifactId: card.id })
  const open = usePath() === href
  const fetchSrc = () => client.fetchQuery({ queryKey: artifactKey(card.id), queryFn: () => fetchArtifact(card.id) }).then((view) => view.src)
  const download = () => fetchSrc().then((src) => {
    const link = document.createElement('a')
    link.href = src
    link.download = card.title
    link.click()
  }, toastError)
  const newTab = () => {
    const tab = window.open('', '_blank')
    fetchSrc().then((src) => { if (tab) tab.location.href = src }, (error: Error) => { tab?.close(); toastError(error) })
  }
  const click = (event: MouseEvent) => {
    if (card.kind !== 'pdf' || !matchMedia(PHONE).matches || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    newTab()
  }
  const body = <>
    <KindTile kind={shown.kind} title={shown.title} />
    <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
      <b className="truncate text-[14px] font-medium">{shown.title}</b>
      <span className="flex items-center gap-1 text-[12px] text-mute"><I icon={ACCESS_ICON[shown.access]} size={11} />{metaOf(shown)}</span>
    </span>
    <I icon={card.kind === 'file' ? Download04Icon : ArrowRight01Icon} size={16} className={card.kind === 'file' ? 'shrink-0 text-mute' : 'shrink-0 text-mute-2'} />
  </>
  if (card.kind === 'file') return <Button type="button" variant="bare" onClick={() => void download()} aria-label={`Download ${shown.title}`} className={cn(CARD, 'cursor-pointer')}>{body}</Button>
  return <a href={href} onClick={click} aria-current={open || undefined} aria-label={`Open ${shown.title}`} className={CARD}>{body}</a>
}

const CARD = 'flex w-[320px] max-w-full items-center gap-2.5 rounded-xl border border-hair bg-card py-2 pr-2.5 pl-2 text-ink no-underline transition-colors hover:bg-tint aria-current:bg-tint'
