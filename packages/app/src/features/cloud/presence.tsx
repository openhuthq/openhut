import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Presence, type HereField } from '@openhut/common/cloud/cloud.ts'
import { hueOf, PersonFace, PersonFaces } from '@/components/custom/person-face'
import { RED, Tinted, useStickyToast } from '@/components/custom/toast'
import { Button } from '@/components/ui/button'
import { nameOf, useCloud } from '@/features/cloud/api'
import { request } from '@/lib/api-client'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const PRESENCE_KEY = ['presence']
const BEAT_MS = 10_000
const POLL_MS = 15_000
const TYPING_IDLE_MS = 4000
type Person = Presence['people'][number]

let typing = false
let typingTimer: ReturnType<typeof setTimeout> | undefined
const typingListeners = new Set<() => void>()

export function typed(text: string): void {
  clearTimeout(typingTimer)
  setTyping(Boolean(text.trim()))
  if (text.trim()) typingTimer = setTimeout(() => setTyping(false), TYPING_IDLE_MS)
}

function setTyping(next: boolean): void {
  if (typing === next) return
  typing = next
  for (const listener of typingListeners) listener()
}

export function usePresence() {
  const on = useCloud().data?.status === 'on'
  return useQuery({ queryKey: PRESENCE_KEY, queryFn: () => request({ schema: Presence, computer: 'local', path: '/api/cloud/presence' }), enabled: on, refetchInterval: on ? POLL_MS : false })
}

export function usePeople(agentId: string): Person[] {
  const people = usePresence().data?.people ?? []
  return people.filter((each, index) => each.agentId === agentId && people.findIndex((other) => other.agentId === agentId && other.email === each.email) === index)
}

export function Here({ agentId, field }: { agentId: string; field: HereField | null }) {
  const on = useCloud().data?.status === 'on'
  const client = useQueryClient()
  const isTyping = useSyncExternalStore((listener) => { typingListeners.add(listener); return () => { typingListeners.delete(listener) } }, () => typing)
  useEffect(() => {
    if (!on) return
    const post = (agent: string | null) => request({ schema: Presence, computer: 'local', path: '/api/cloud/presence', method: 'PUT', body: { agent, field: agent && field, typing: Boolean(agent) && isTyping } })
      .then((presence) => client.setQueryData(PRESENCE_KEY, presence), () => undefined)
    const shown = () => document.visibilityState === 'visible'
    const beat = () => void post(shown() ? agentId : null)
    const leave = () => void post(null)
    beat()
    const timer = setInterval(beat, BEAT_MS)
    document.addEventListener('visibilitychange', beat)
    addEventListener('pagehide', leave)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
      removeEventListener('pagehide', leave)
    }
  }, [on, agentId, field, isTyping, client])
  useEffect(() => () => setTyping(false), [agentId])
  return null
}

export function Faces({ agentId, size = 24 }: { agentId: string; size?: number }) {
  const people = usePeople(agentId)
  if (!people.length) return null
  return <span title={people.map((each) => nameOf(each.email)).join(', ')}><PersonFaces people={people.map((each) => ({ name: nameOf(each.email), email: each.email }))} size={size} /></span>
}

export function useHolder({ agentId, field }: { agentId: string; field: HereField }): { holder: Person | null; locked: boolean } {
  const presence = usePresence().data
  const holder = usePeople(agentId).filter((each) => each.field === field).sort((a, b) => a.since - b.since)[0] ?? null
  const mine = presence?.since ?? null
  return { holder, locked: Boolean(holder) && (mine === null || (holder?.since ?? 0) < mine) }
}

export function FieldBox({ agentId, field, className, children }: { agentId: string; field: HereField; className?: string; children: ReactNode }) {
  const { holder } = useHolder({ agentId, field })
  const hue = holder && hueOf(holder.email)
  return <div className={cn('relative', className)}>
    {children}
    {holder && hue && <span className="pointer-events-none absolute -inset-0.5 rounded-lg border-[1.5px]" style={{ borderColor: hue }}>
      <span className="absolute -top-2.5 right-2 rounded-md px-1.5 py-px text-[11px] font-medium text-white" style={{ background: hue }}>{nameOf(holder.email)}</span>
    </span>}
  </div>
}

export function Typing({ agentId }: { agentId: string }) {
  const people = usePeople(agentId).filter((each) => each.typing)
  const names = people.map((each) => nameOf(each.email))
  return <div className={cn('mx-auto mb-1.5 flex h-4 items-center justify-center gap-1.5 text-[12px] text-mute transition-opacity', !names.length && 'opacity-0')} aria-live="polite">
    {people.length > 0 && <PersonFaces people={people.map((each) => ({ name: nameOf(each.email), email: each.email }))} size={16} />}
    {names.length > 0 && `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are` : `${names[0]} is`} typing…`}
  </div>
}

export function EditLock({ agentId, field, draft, onClose }: { agentId: string; field: HereField; draft: string | null; onClose: () => void }) {
  const { holder, locked } = useHolder({ agentId, field })
  if (!locked || !holder) return null
  const name = nameOf(holder.email)
  return <div className="flex items-center gap-2.5 text-[13px]" role="status">
    <PersonFace name={name} email={holder.email} size={20} />
    <span className="flex-1 text-body">{name} is editing. You can edit when they’re done.</span>
    {draft !== null && <Button type="button" variant="secondary" onClick={() => void copyText(draft).then((copied) => { if (copied) toast('Draft copied') })}>Copy my draft</Button>}
    <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
  </div>
}

export function Mismatch() {
  const mismatch = usePresence().data?.mismatch ?? []
  const names = [...new Set(mismatch.map((each) => nameOf(each.email)))]
  useStickyToast({ id: 'mismatch', notice: names.length ? { lead: <Tinted icon={Alert02Icon} hue={RED} />, title: 'Sharing paused', note: `Your team list doesn’t match ${names.join(' and ')}’s. Check it with them on a call.` } : null })
  return null
}
