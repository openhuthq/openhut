import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { Alert02Icon, Cancel01Icon, FingerPrintIcon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { kitWord, nearestWord, readKit, validKit } from '@openhut/common/vault/kit-file.ts'
import { agentPath } from '@/app/routes'
import { ConfirmButton } from '@/components/confirm-button'
import { DeviceIcon } from '@/components/custom/device'
import { DropZone } from '@/components/custom/drop-zone'
import { PersonFace, PersonFaces } from '@/components/custom/person-face'
import { AMBER, notify, Tinted, Toast, Toasts } from '@/components/custom/toast'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { DRAG, I, PILL } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAgents } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { QrCode } from '@/features/agents/qr-code'
import { nameOf, REMOVE_DETAIL, useCloud, useRemoveMac, usePairing, usePasskeys, usePasskeyUnlock, useSignIn, useSignOut, useStartOver, useUnlock } from '@/features/cloud/api'
import { Mascot } from '@/features/cloud/sign-in'
import { chooseWorkspace, useAsk, useCancelAsk } from '@/features/cloud/workspaces'
import { Mismatch } from '@/features/cloud/presence'
import { freshDevice, markSeen, seenDevices } from '@/features/cloud/seen'
import { Spinner } from '@/components/ui/spinner'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows, useConfirming } from '@/features/settings/kit'
import { isPhone } from '@/lib/native'
import { navigate } from '@/lib/router'
import { longDate, shortDateTime } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

function Unlock({ cloud }: { cloud: Cloud }) {
  const [way, setWay] = useState<'kit' | 'code' | 'admin' | null>(null)
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
  if (way === 'kit') return <KitEntry cloud={cloud} onBack={() => setWay(null)} />
  if (way === 'code') return <CodeEntry onBack={() => setWay(null)} />
  if (way === 'admin' || cloud.asking) return <AdminWait cloud={cloud} onBack={() => setWay(null)} />
  const canPasskey = Boolean(helper?.passkeys && helper.prf)
  return <Window>
    <Hut mood="key" className="size-[84px]" />
    <h1 className="m-0 text-[24px]/[1.2] font-semibold tracking-[-.01em]">Welcome back, {nameOf(cloud.email ?? '')}</h1>
    {canPasskey && <>
      <Button type="button" variant="primary" className="mt-2 h-10 w-[380px] justify-center gap-2 text-[14px]" disabled={passkey.isPending} onClick={() => passkey.mutate(undefined, { onError: toastError })}><I icon={FingerPrintIcon} size={18} />{passkey.isPending ? 'Unlocking…' : 'Continue with Touch ID'}</Button>
      <span className="mt-3 text-[12px] text-mute">No passkey on this {HERE}?</span>
    </>}
    {!canPasskey && <span className="mt-1 text-[13px] text-body">{helper && !helper.error ? `This ${HERE} can't use passkeys. Pick another way.` : `Unlock to bring everything to this ${HERE}.`}</span>}
    <div className="w-[380px] rounded-lg border border-hair bg-card p-1 text-left">
      <Rows>
        <Row onClick={() => setWay('code')} icon={<Mascot kind="phone" size={30} />} title="Use my iPhone or another Mac" note="Scan a code with it"><Chevron /></Row>
        {cloud.kitInCloud && <Row onClick={() => setWay('kit')} icon={<Mascot kind="kit" size={30} />} title="Use my recovery kit" note="The file you saved"><Chevron /></Row>}
        {cloud.canAsk && <Row onClick={() => setWay('admin')} icon={<Mascot kind="team" size={30} />} title="Ask an admin" note="Get your team workspaces back"><Chevron /></Row>}
      </Rows>
    </div>
    {!cloud.kitInCloud && <NoKitYet />}
    {leave}
  </Window>
}

function AdminWait({ cloud, onBack }: { cloud: Cloud; onBack: () => void }) {
  const ask = useAsk()
  const cancel = useCancelAsk()
  const asking = cloud.asking
  const asked = useRef(false)
  useEffect(() => {
    if (asking || asked.current) return
    asked.current = true
    ask.mutate()
  }, [asking, ask])
  const back = () => cancel.mutate(undefined, { onSettled: onBack })
  const rooms = asking?.rooms ?? []
  return <Window>
    {asking?.denied && <>
      <h1 className="m-0 text-[22px]/[1.25] font-semibold">Not approved</h1>
      <p className="m-0 max-w-[420px] text-[14px] text-body">An admin denied this {HERE}, or the request expired after a day.</p>
      <Button type="button" variant="primary" className={PILL} disabled={ask.isPending} onClick={() => ask.mutate(undefined, { onError: toastError })}>Ask again</Button>
    </>}
    {!asking?.denied && !ask.isError && <>
      {rooms.length === 0 && <h1 className="m-0 text-[22px]/[1.25] font-semibold">Asking an admin…</h1>}
      {rooms.map((room, index) => <div key={index} className="flex flex-col items-center gap-3">
        <PersonFaces people={room.admins.map((email) => ({ name: nameOf(email), email }))} size={56} />
        <h1 className="m-0 text-[22px]/[1.25] font-semibold">Waiting for {who(room.admins)}</h1>
        <p className="m-0 text-[14px] text-body">When they call, read them these 4 words.</p>
        <div className="flex gap-2">{(room.words ?? ['', '', '', '']).map((word, at) => <span key={at} className="min-w-[72px] rounded-lg border border-hair bg-card px-3.5 py-2 text-[17px] font-semibold">{word || '…'}</span>)}</div>
      </div>)}
      <Spinner className="mt-1" />
    </>}
    <ErrorNote message={ask.error?.message ?? asking?.error ?? undefined} />
    <Button type="button" variant="text" className="text-[12px] font-normal text-mute underline" disabled={cancel.isPending} onClick={back}>Try another way</Button>
  </Window>
}

function who(admins: string[]): string {
  const names = admins.map(nameOf)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'an admin'
}

function NoKitYet() {
  const cloud = useCloud()
  const startOver = useStartOver()
  const { confirming, setConfirming, box } = useConfirming()
  return <div className="flex w-[380px] flex-col items-center gap-3">
    <p className="m-0 text-[13px] text-body">Save a recovery kit on the {HERE} you signed in on first. Then come back here.</p>
    <Button type="button" variant="secondary" className={PILL} disabled={cloud.isFetching} onClick={() => void cloud.refetch()}>{cloud.isFetching ? 'Checking…' : 'Check again'}</Button>
    <div ref={box} className="flex flex-wrap items-center justify-center gap-2">
      {confirming
        ? <>
          <span className="w-full text-[12px] text-mute">Start over with a new, empty backup? Your other {HERE}s will need the new kit’s words.</span>
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
    <p className="m-0 max-w-[460px] text-[14px] text-body">Open OpenHut on it, tap Add a Mac in Devices, and point it here.</p>
    <span className="mt-2 grid size-[208px] place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!">{pairing.data && <QrCode text={pairing.data.qr} label={`Code to unlock this ${HERE}`} />}</span>
    <span className="mt-1 text-[12px] text-mute">Can't scan? Type this on your other device</span>
    <span className="font-mono text-[15px] tracking-[.08em] select-all">{pairing.data?.code ?? '…'}</span>
    <ErrorNote message={pairing.error?.message} />
    <Button type="button" variant="text" className="text-[12px] font-normal text-mute underline" onClick={onBack}>Try another way</Button>
  </Window>
}

export function NewMacAlert({ cloud }: { cloud: Cloud }) {
  const seen = useSyncExternalStore(seenDevices.subscribe, seenDevices.get)
  const remove = useRemoveMac()
  const fresh = freshDevice({ cloud, seen, now: Date.now() })
  if (!fresh?.addedAt || cloud.status !== 'on') return null
  const when = shortDateTime.format(new Date(fresh.addedAt))
  const thing = fresh.kind === 'server' ? 'computer' : 'Mac'
  return <Toast alert lead={<DeviceIcon kind={fresh.kind} />} title={`New ${thing} added`} note={fresh.name ? <><span className="truncate">{fresh.name}</span><span>{when}</span></> : when}>
    {cloud.youngUntil
      ? <span className="w-[104px] shrink-0 text-right text-[12px]/[1.3] text-mute">Remove it from an older device</span>
      : <ConfirmButton variant="secondary" className="shrink-0 rounded-xl px-3.5 text-[12.5px] text-fail" disabled={remove.isPending} question={`Remove ${fresh.name ?? `this ${thing}`}?`} detail={`Added ${when}. ${REMOVE_DETAIL}`} action="Remove" onConfirm={() => remove.mutate(fresh.key)}>Not me</ConfirmButton>}
    <Button type="button" variant="text" className="shrink-0 px-1 text-mute" aria-label="It's mine" title="It's mine" onClick={() => markSeen([fresh.key])}><I icon={Cancel01Icon} size={14} /></Button>
  </Toast>
}

function KitEntry({ cloud, onBack }: { cloud: Cloud; onBack: () => void }) {
  const [typing, setTyping] = useState(false)
  const [problem, setProblem] = useState<{ text: string; tone: 'fail' | 'warn' }>()
  const unlock = useUnlock()
  const me = cloud.email ?? ''
  const tryKit = (text: string) => {
    const kit = readKit(text)
    const replaced = kit?.kitId && cloud.cloudKit && kit.kitId !== cloud.cloudKit.id ? cloud.cloudKit.savedAt : undefined
    if (!kit) return setProblem({ tone: 'fail', text: 'That doesn’t look like a recovery kit. Drop the file OpenHut saved, or type the words instead.' })
    if (kit.email && me && kit.email !== me) return setProblem({ tone: 'fail', text: `This kit is for ${kit.email}. You’re signed in as ${me}. Drop ${nameOf(me)}’s kit, or sign out and sign in as ${nameOf(kit.email)}.` })
    if (replaced !== undefined) return setProblem({ tone: 'warn', text: `This kit was replaced${replaced ? ` on ${longDate.format(new Date(replaced))}` : ''} and no longer works. Use the newest one, or another way in.` })
    if (!kit.valid) return setProblem({ tone: 'fail', text: 'One of the words in this kit got changed, so it can’t open your cloud. Try another copy, or type the words instead.' })
    setProblem(undefined)
    unlock.mutate({ words: kit.words }, { onError: (err) => setProblem({ tone: 'fail', text: err.message }) })
  }
  if (typing) return <KitWordsEntry onBack={() => setTyping(false)} />
  return <Window>
    <h1 className="m-0 text-[22px]/[1.25] font-semibold">Use your recovery kit</h1>
    <p className="m-0 -mt-2 text-[14px] text-body">The file you saved when you turned on OpenHut Cloud.</p>
    <div className="mt-2 flex w-[460px] flex-col gap-3">
      {problem && <p role="alert" className={cn('m-0 rounded-xl px-3.5 py-3 text-left text-[13.5px]/[1.45]', problem.tone === 'warn' ? 'bg-warning-subtle text-warning-strong' : 'bg-[color-mix(in_oklch,var(--fail)_10%,transparent)] text-ink')}>{problem.text}</p>}
      <DropZone className="py-8" onText={tryKit}>{(hot) => <>
        <Hut key={problem?.text} mood={unlock.isPending ? 'key' : hot ? 'surprised' : problem ? 'worried' : 'looking'} className={cn('calm mb-1 size-16', unlock.isPending && 'key-turn', problem && !hot && 'blink-slow')} />
        <span className="text-[15px] font-medium text-ink">{unlock.isPending ? 'Unlocking…' : 'Drop your kit here'}</span>
        {!unlock.isPending && <span className="text-[12.5px] text-mute">or paste it</span>}
      </>}</DropZone>
      <span className="text-[12.5px] text-mute">Don’t have the file? <Button type="button" variant="text" className="h-auto p-0 text-[12.5px] font-normal text-ink underline underline-offset-2" onClick={() => setTyping(true)}>Type the words instead</Button>.</span>
    </div>
    <Button type="button" variant="text" className="text-[12px] font-normal text-mute" onClick={onBack}>Back</Button>
  </Window>
}

function KitWordsEntry({ onBack }: { onBack: () => void }) {
  const [words, setWords] = useState<string[]>(Array.from({ length: 12 }, () => ''))
  const [typo, setTypo] = useState<{ at: number; text: string }>()
  const unlock = useUnlock()
  const set = (input: HTMLInputElement, index: number) => {
    const typed = input.value.toLowerCase().split(/\s+/)
    const parts = typed.filter(Boolean)
    setTypo(undefined)
    setWords((all) => all.map((word, i) => i === index ? parts[0] ?? '' : i > index && i < index + parts.length ? parts[i - index] : word))
    const next = typed.length > 1 ? input.form?.querySelectorAll('input')[Math.min(index + Math.max(parts.length, 1), 11)] : undefined
    if (!next || next === input) return
    next.focus()
    next.select()
  }
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = readKit(event.clipboardData.getData('text'))
    if (!pasted) return
    event.preventDefault()
    setTypo(undefined)
    setWords(pasted.words)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const at = words.findIndex((word) => !kitWord(word))
    if (at >= 0) return setTypo({ at, text: `Word ${at + 1} isn’t a kit word. Did you mean “${nearestWord(words[at])}”?` })
    if (!validKit(words)) return setTypo({ at: -1, text: 'These words don’t fit together. Check each one against your kit, in order.' })
    unlock.mutate({ words })
  }
  return <Window>
    <form onSubmit={submit} className="flex flex-col items-center gap-4">
      <Hut key={typo?.text} mood={typo ? 'worried' : 'key'} className={cn('calm size-[84px]', typo && 'blink-slow')} />
      <h1 className="m-0 text-[22px]/[1.25] font-semibold">Type the 12 words</h1>
      <p className="m-0 text-[14px] text-body">From your recovery kit, in order.</p>
      <div className="mt-2 grid w-[460px] grid-cols-3 gap-2">{words.map((word, index) => <label key={index} className={cn('flex h-10 items-center gap-2 rounded-xl border border-hair bg-card px-3 text-[13px] focus-within:border-ink', typo?.at === index && 'border-fail text-fail focus-within:border-fail')}>
        <span className="w-4 text-[11px] text-mute tabular-nums">{index + 1}</span>
        <Input className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[13px] text-inherit focus-visible:outline-none" value={word} autoFocus={index === 0} autoComplete="off" spellCheck={false} aria-label={`Word ${index + 1}`} aria-invalid={typo?.at === index || undefined} onChange={(event) => set(event.target, index)} onPaste={paste} />
      </label>)}</div>
      <ErrorNote className="w-[460px] text-left" message={typo?.text ?? unlock.error?.message} />
      <Button type="submit" variant="primary" disabled={words.some((word) => !word) || unlock.isPending} className="h-10 w-[460px] justify-center text-[14px]">{unlock.isPending ? 'Unlocking…' : 'Unlock'}</Button>
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
    notify(problem ? { lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: 'Not everything came back', note: problem } : { title: 'Your agents are back', note: `Restored from your cloud backup on this ${HERE}.` })
    navigate(agent ? agentPath({ agentId: agent }) : '/', true)
  }, [restoring, landing, agent, problem, queries])
  if (!cloud) return children
  if (cloud.status === 'locked' && !isPhone()) return <Unlock cloud={cloud} />
  if (restoring || landing) return <Restoring cloud={cloud} />
  return <>{children}<Toasts>{cloud.status === 'locked' && <Toast lead={<Hut mood="key" className="size-8" />} title={`Unlock OpenHut on your ${HERE}`} note="Your agents come back here after that." />}<NewMacAlert cloud={cloud} /><Mismatch /></Toasts><GoneNotice cloud={cloud} /><Joins cloud={cloud} /></>
}

function Joins({ cloud }: { cloud: Cloud }) {
  const known = useRef<Map<string, string[]> | null>(null)
  useEffect(() => {
    const now = new Map(cloud.workspaces.map((workspace) => [workspace.id, workspace.members.map((member) => member.email)]))
    const before = known.current
    known.current = now
    if (!before) return
    for (const workspace of cloud.workspaces) {
      const was = before.get(workspace.id)
      for (const email of was ? workspace.members.map((member) => member.email).filter((each) => !was.includes(each) && each !== cloud.email) : []) notify({ lead: <PersonFace name={nameOf(email)} email={email} size={26} />, title: `${nameOf(email)} joined ${workspace.name}`, note: email })
    }
  }, [cloud.workspaces, cloud.email])
  return null
}

function GoneNotice({ cloud }: { cloud: Cloud }) {
  const seen = useRef(cloud.gone.length)
  useEffect(() => {
    const fresh = cloud.gone.slice(seen.current)
    seen.current = cloud.gone.length
    const last = fresh.at(-1)
    if (!last) return
    const home = cloud.workspaces.find((each) => each.home)
    if (home) chooseWorkspace(home.id)
    notify({ lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: last.why === 'deleted' ? `${last.name} was deleted` : `You were removed from ${last.name}`, note: `Its agents moved to the trash on this ${HERE}.` })
  }, [cloud.gone, cloud.workspaces])
  return null
}

function Restoring({ cloud }: { cloud: Cloud }) {
  const queries = useQueryClient()
  const agents = useAgents().data ?? []
  const { done, total, current } = cloud.backup
  useEffect(() => void queries.invalidateQueries({ queryKey: ['agents'] }), [done, queries])
  const slots = Array.from({ length: Math.min(total, 3) }, (_, index) => agents[index])
  return <Window>
    <div className="flex h-[84px] items-end gap-3">{total === 0 ? <Hut mood="key" className="calm key-turn size-[84px]" /> : slots.map((each, index) => each ? <Face key={each.id} agent={each} size={64} /> : <span key={index} className="size-16 rounded-full bg-soft" />)}</div>
    <h1 className="m-0 mt-2 text-[22px]/[1.25] font-semibold">{total === 0 && cloud.email ? `Welcome back, ${nameOf(cloud.email)}` : 'Bringing your agents back'}</h1>
    <p className="m-0 text-[14px] text-body">{current ? `Restoring ${current} · ${Math.min(done + 1, total)} of ${total}` : `Unlocked. Bringing your agents and chats to this ${HERE}…`}</p>
  </Window>
}

export function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>OpenHut</div>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
  </div>
}
