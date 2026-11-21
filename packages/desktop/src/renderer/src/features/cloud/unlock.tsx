import { useEffect, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { Cancel01Icon, FingerPrintIcon, LaptopIcon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { agentPath } from '@/app/routes'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { DRAG, I, PILL } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAgents } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { QrCode } from '@/features/agents/qr-code'
import { nameOf, useCloud, useNotMe, usePairing, usePasskeys, usePasskeyUnlock, useSignIn, useSignOut, useStartOver, useUnlock } from '@/features/cloud/api'
import { Mascot } from '@/features/cloud/sign-in'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows, useConfirming } from '@/features/settings/kit'
import { isPhone } from '@/lib/native'
import { navigate } from '@/lib/router'
import { shortDate } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SEEN_KEY = 'openhut.seen-devices'
const ALERT_MS = 3 * 24 * 60 * 60_000

function Unlock({ cloud }: { cloud: Cloud }) {
  const [way, setWay] = useState<'kit' | 'code' | null>(null)
  const signOut = useSignOut()
  const signIn = useSignIn()
  const helper = usePasskeys()
  const passkey = usePasskeyUnlock()
  const leave = <Button type="button" variant="text" className="text-[12px] font-normal text-mute" disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out, keep this {HERE} as it is</Button>
  if (cloud.needsSignIn) return <Window>
    <Hut mood="worried" className="size-[84px]" />
    <h1 className="m-0 text-[22px]/[1.25] font-semibold">This {HERE} was removed</h1>
    <p className="m-0 max-w-[400px] text-[14px] text-body">It was taken off your account from another device, and can't open anything new. Sign in again to unlock it.</p>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[320px] justify-center text-[14px]" disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}>Sign in again</Button>
    {leave}
  </Window>
  if (way === 'kit') return <KitEntry onBack={() => setWay(null)} />
  if (way === 'code') return <CodeEntry onBack={() => setWay(null)} />
  const canPasskey = Boolean(helper?.passkeys && helper.prf)
  return <Window>
    <Hut mood="key" className="size-[84px]" />
    <h1 className="m-0 text-[24px]/[1.2] font-semibold tracking-[-.01em]">Welcome back, {nameOf(cloud.email ?? '')}</h1>
    {canPasskey && <>
      <Button type="button" variant="primary" className="mt-2 h-10 w-[380px] justify-center gap-2 text-[14px]" disabled={passkey.isPending} onClick={() => passkey.mutate(undefined, { onError: toastError })}><I icon={FingerPrintIcon} size={18} />{passkey.isPending ? 'Unlocking…' : 'Continue with passkey'}</Button>
      <span className="mt-3 text-[12px] text-mute">No passkey on this {HERE}?</span>
    </>}
    {!canPasskey && <span className="mt-1 text-[13px] text-body">{helper && !helper.error ? `This ${HERE} can't use passkeys. Pick another way.` : `Unlock to bring everything to this ${HERE}.`}</span>}
    <div className="w-[380px] rounded-lg border border-hair bg-card p-1 text-left">
      <Rows>
        <Row onClick={() => setWay('code')} icon={<Mascot kind="phone" size={30} />} title="Use my iPhone or another Mac" note="Scan a code with it"><Chevron /></Row>
        {cloud.kitInCloud && <Row onClick={() => setWay('kit')} icon={<Mascot kind="kit" size={30} />} title="Use my recovery kit" note="The 12 words you saved"><Chevron /></Row>}
      </Rows>
    </div>
    {!cloud.kitInCloud && <NoKitYet />}
    {leave}
  </Window>
}

function NoKitYet() {
  const cloud = useCloud()
  const startOver = useStartOver()
  const { confirming, setConfirming, box } = useConfirming()
  return <div className="flex w-[380px] flex-col items-center gap-3">
    <p className="m-0 text-[13px] text-body">Save a recovery kit on the {HERE} you signed in on first. Then come back here.</p>
    <Button type="button" variant="secondary" className={PILL} disabled={cloud.isFetching} onClick={() => void cloud.refetch()}>{cloud.isFetching ? 'Checking…' : 'Check again'}</Button>
    <div ref={box} className="flex items-center gap-2">
      {confirming
        ? <>
          <span className="text-[12px] text-mute">Start over with a new, empty backup?</span>
          <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" variant="danger" className={PILL} disabled={startOver.isPending} onClick={() => startOver.mutate(undefined, { onError: toastError })}>Start over</Button>
        </>
        : <Button type="button" variant="text" className="text-[12px] font-normal text-mute" onClick={() => setConfirming(true)}>Start over</Button>}
    </div>
  </div>
}


function CodeEntry({ onBack }: { onBack: () => void }) {
  const pairing = usePairing(true)
  return <Window>
    <h1 className="m-0 text-[22px]/[1.25] font-semibold">Scan with your iPhone or other Mac</h1>
    <p className="m-0 max-w-[460px] text-[14px] text-body">Open OpenHut there, go to Settings, Devices, Add a phone or Mac, and point it here.</p>
    <span className="mt-2 grid size-[208px] place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!">{pairing.data && <QrCode text={pairing.data.qr} label={`Code to unlock this ${HERE}`} />}</span>
    <span className="mt-1 text-[12px] text-mute">Can't scan? Type this on your other device</span>
    <span className="font-mono text-[15px] tracking-[.08em] select-all">{pairing.data?.code.split('-').join(' · ') ?? '…'}</span>
    <ErrorNote message={pairing.error?.message} />
    <Button type="button" variant="text" className="text-[12px] font-normal text-mute underline" onClick={onBack}>Try another way</Button>
  </Window>
}

export function NewMacAlert({ cloud }: { cloud: Cloud }) {
  const [seen, setSeen] = useState<string[]>(() => readSeen())
  const notMe = useNotMe()
  const since = Date.parse(cloud.devices.find((device) => device.here)?.addedAt ?? '') || 0
  const fresh = cloud.devices.find((device) => !device.here && device.addedAt && Date.parse(device.addedAt) > since && Date.now() - Date.parse(device.addedAt) < ALERT_MS && !seen.includes(device.key))
  if (!fresh?.addedAt || cloud.status !== 'on') return null
  const when = `${shortDate.format(new Date(fresh.addedAt))}, ${new Date(fresh.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const dismiss = () => {
    const next = [...seen, fresh.key]
    setSeen(next)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch { return }
  }
  const remove = () => notMe.mutate(fresh.key, {
    onError: toastError,
    onSuccess: () => {
      toast('Mac removed. It can’t open anything new. Keys changed. Save a new recovery kit.')
      navigate('/settings/cloud?open=kit')
    },
  })
  return <div role="alert" className="fixed top-14 right-6 z-50 flex w-[380px] items-center gap-3 rounded-[18px] border border-hair bg-card p-2.5 pr-3 shadow-[0_8px_24px_oklch(0%_0_0/.10)]">
    <span className="grid size-9 shrink-0 place-items-center text-ink"><I icon={LaptopIcon} size={20} /></span>
    <span className="grid min-w-0 flex-1 gap-px text-[13px]"><span className="font-semibold">New Mac added</span><span className="truncate text-mute">{when}</span></span>
    <ConfirmButton variant="secondary" className="shrink-0 rounded-xl px-3.5 text-[12.5px] text-fail" disabled={notMe.isPending} question="Remove this device?" detail={`It was added ${when}. Removing it changes every key, so it can't open anything new. Do this only if it isn't yours.`} action="Remove" onConfirm={remove}>Not me</ConfirmButton>
    <Button type="button" variant="text" className="shrink-0 px-1 text-mute" aria-label="It's mine" title="It's mine" onClick={dismiss}><I icon={Cancel01Icon} size={14} /></Button>
  </div>
}

function readSeen(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}

export function markSeen(keys: string[]): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen(), ...keys])) } catch { return }
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
    unlock.mutate({ words })
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
  return <>{children}<NewMacAlert cloud={cloud} /></>
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
