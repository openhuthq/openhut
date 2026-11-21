import { useEffect, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { agentPath } from '@/app/routes'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { DRAG } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAgents } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { nameOf, useCloud, useSignOut, useUnlock } from '@/features/cloud/api'
import { Mascot } from '@/features/cloud/sign-in'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { isPhone } from '@/lib/native'
import { navigate } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

function Unlock({ cloud }: { cloud: Cloud }) {
  const [kit, setKit] = useState(false)
  const signOut = useSignOut()
  if (kit) return <KitEntry onBack={() => setKit(false)} />
  return <Window>
    <Hut mood="key" className="size-[84px]" />
    <h1 className="m-0 text-[24px]/[1.2] font-semibold tracking-[-.01em]">Welcome back, {nameOf(cloud.email ?? '')}</h1>
    <span className="mt-1 text-[13px] text-body">Unlock to bring everything to this {HERE}.</span>
    <div className="w-[380px] rounded-lg border border-hair bg-card p-1 text-left">
      <Rows><Row onClick={() => setKit(true)} icon={<Mascot kind="kit" size={30} />} title="Use my recovery kit" note="The 12 words you saved"><Chevron /></Row></Rows>
    </div>
    <Button type="button" variant="text" className="text-[12px] font-normal text-mute" disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out, keep this {HERE} as it is</Button>
  </Window>
}

function KitEntry({ onBack }: { onBack: () => void }) {
  const [words, setWords] = useState<string[]>(Array.from({ length: 12 }, () => ''))
  const unlock = useUnlock()
  const set = (input: HTMLInputElement, index: number) => {
    const typed = input.value.toLowerCase().split(/\s+/)
    const parts = typed.filter(Boolean)
    setWords((all) => all.map((word, i) => i === index ? parts[0] ?? '' : i > index && i < index + parts.length ? parts[i - index] : word))
    if (typed.length > 1) input.form?.querySelectorAll('input')[Math.min(index + Math.max(parts.length, 1), 11)]?.focus()
  }
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').toLowerCase().replace(/\d+\./g, ' ').split(/\s+/).filter(Boolean)
    if (pasted.length !== 12) return
    event.preventDefault()
    setWords(pasted)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    unlock.mutate(words)
  }
  return <Window>
    <form onSubmit={submit} className="flex flex-col items-center gap-4">
      <Mascot kind="kit" size={84} />
      <h1 className="m-0 text-[22px]/[1.25] font-semibold">Type your 12 words</h1>
      <p className="m-0 text-[14px] text-body">From the recovery kit you saved.</p>
      <div className="mt-2 grid w-[460px] grid-cols-3 gap-2">{words.map((word, index) => <label key={index} className="flex h-10 items-center gap-2 rounded-xl border border-hair bg-card px-3 text-[13px] focus-within:border-ink">
        <span className="w-4 text-[11px] text-mute tabular-nums">{index + 1}</span>
        <Input className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[13px] focus-visible:outline-none" value={word} autoFocus={index === 0} autoComplete="off" spellCheck={false} aria-label={`Word ${index + 1}`} onChange={(event) => set(event.target, index)} onPaste={paste} />
      </label>)}</div>
      <Button type="submit" variant="primary" disabled={words.some((word) => !word) || unlock.isPending} className="mt-2 h-10 w-[460px] justify-center text-[14px]">{unlock.isPending ? 'Unlocking…' : 'Unlock'}</Button>
      <ErrorNote message={unlock.error?.message} />
      <Button type="button" variant="text" className="text-[12px] font-normal text-mute" onClick={onBack}>Back</Button>
    </form>
  </Window>
}

export function CloudGate({ children }: { children: ReactNode }) {
  const cloud = useCloud().data
  const queries = useQueryClient()
  const [landing, setLanding] = useState(false)
  const restoring = cloud?.backup.state === 'restoring'
  const agent = cloud?.backup.agent
  const problem = cloud?.backup.problem
  useEffect(() => {
    if (restoring) return setLanding(true)
    if (!landing) return
    setLanding(false)
    void queries.invalidateQueries()
    if (problem) toast(problem)
    navigate(agent ? agentPath({ agentId: agent }) : '/', true)
  }, [restoring, landing, agent, problem, queries])
  if (isPhone() || !cloud) return children
  if (cloud.status === 'locked') return <Unlock cloud={cloud} />
  if (restoring || landing) return <Restoring cloud={cloud} />
  return children
}

function Restoring({ cloud }: { cloud: Cloud }) {
  const queries = useQueryClient()
  const agents = useAgents().data ?? []
  const { done, total, current } = cloud.backup
  useEffect(() => void queries.invalidateQueries({ queryKey: ['agents'] }), [done, queries])
  const slots = Array.from({ length: Math.min(total, 3) }, (_, index) => agents[index])
  return <Window>
    <div className="flex h-16 items-center gap-3">{total === 0 ? <Hut mood="key" className="size-16" /> : slots.map((each, index) => each ? <Face key={each.id} agent={each} size={64} /> : <span key={index} className="size-16 rounded-full bg-soft" />)}</div>
    <h1 className="m-0 mt-2 text-[22px]/[1.25] font-semibold">Bringing your agents back</h1>
    <p className="m-0 text-[14px] text-body">{current ? `Restoring ${current} · ${Math.min(done + 1, total)} of ${total}` : 'Unlocking your backup…'}</p>
  </Window>
}

function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>OpenHut</div>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
  </div>
}
