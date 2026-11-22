import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { Alert02Icon, Cancel01Icon, FingerPrintIcon, Key01Icon, SmartPhone01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
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
import { QrCode } from '@/features/agents/qr-code'
import { nameOf, notifyUnlock, REMOVE_DETAIL, useCloud, useRemoveMac, usePairing, usePasskeys, usePasskeyUnlock, useSignIn, useSignOut, useStartOver, useUnlock } from '@/features/cloud/api'
import { Mascot } from '@/features/cloud/sign-in'
import { PRIMARY, Step } from '@/features/cloud/step'
import { chooseWorkspace, useAsk, useCancelAsk } from '@/features/cloud/workspaces'
import { Mismatch } from '@/features/cloud/presence'
import { freshDevice, markSeen, seenDevices } from '@/features/cloud/seen'
import { Spinner } from '@/components/ui/spinner'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows, useConfirming } from '@/features/settings/kit'
import { isPhone } from '@/lib/native'
import { navigate, usePath } from '@/lib/router'
import { longDate, shortDateTime } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function Unlock({ cloud, back }: { cloud: Cloud; back?: () => void }) {
  const [way, setWay] = useState<'kit' | 'code' | 'admin' | null>(null)
  const signOut = useSignOut()
  const signIn = useSignIn()
  const helper = usePasskeys()
  const passkey = usePasskeyUnlock()
  const leave = <Button type="button" variant="text" className="text-[12px] font-normal text-mute" disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
  if (cloud.needsSignIn) return <Step art={<Hut mood="worried" className="size-[96px]" />} title={`This ${HERE} was removed`} line="Sign in again to unlock it."
    action={<Button type="button" variant="primary" className={PRIMARY} disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}>Sign in again</Button>}>
    {leave}
  </Step>
  if (way === 'kit') return <KitEntry cloud={cloud} onBack={() => setWay(null)} />
  if (way === 'code') return <CodeEntry onBack={() => setWay(null)} />
  if (way === 'admin' || cloud.asking) return <AdminWait cloud={cloud} onBack={() => setWay(null)} />
  const canPasskey = Boolean(helper?.passkeys && helper.prf)
  return <Step art={<Hut mood="key" className="size-[96px]" />} title={`Welcome back, ${nameOf(cloud.email ?? '')}`} line="Unlock to restore your agents." back={back}
    action={canPasskey && <Button type="button" variant="primary" className={cn(PRIMARY, 'gap-2')} disabled={passkey.isPending} onClick={() => passkey.mutate(undefined, { onError: toastError })}><I icon={FingerPrintIcon} size={16} />{passkey.isPending ? 'Unlocking…' : 'Use Touch ID'}</Button>}>
    <div className="w-full max-w-[420px] text-left">
      <Rows>
        <Row onClick={() => setWay('code')} icon={<I icon={SmartPhone01Icon} size={20} className="text-hue-blue" />} title="iPhone or Mac" note="Scan a code"><Chevron /></Row>
        {cloud.kitInCloud && <Row onClick={() => setWay('kit')} icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit" note="File or 12 words"><Chevron /></Row>}
        {cloud.canAsk && <Row onClick={() => setWay('admin')} icon={<I icon={UserGroupIcon} size={20} className="text-hue-amber" />} title="Ask an admin" note="For team workspaces"><Chevron /></Row>}
      </Rows>
    </div>
    {!canPasskey && helper && !helper.error && <span className="text-[12px] text-mute">No Touch ID on this {HERE}.</span>}
    {!cloud.kitInCloud && <NoKitYet />}
    {leave}
  </Step>
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
  const admins = rooms.flatMap((room) => room.admins)
  if (asking?.denied) return <Step art={<Hut mood="worried" className="size-[96px]" />} title="Not approved" line="Denied, or it expired." back={back}
    action={<Button type="button" variant="primary" className={PRIMARY} disabled={ask.isPending} onClick={() => ask.mutate(undefined, { onError: toastError })}>Ask again</Button>} />
  return <Step art={admins.length ? <PersonFaces people={admins.map((email) => ({ name: nameOf(email), email }))} size={64} /> : <Hut mood="looking" className="size-[96px]" />} title={rooms.length ? `Waiting for ${who(admins)}` : 'Asking an admin…'} line={rooms.length ? 'Read them these 4 words.' : undefined} back={back}>
    {rooms.map((room, index) => <div key={index} className="flex gap-2">{(room.words ?? ['', '', '', '']).map((word, at) => <span key={at} className="min-w-[72px] rounded-lg border border-hair bg-card px-3.5 py-2 text-[17px] font-semibold">{word || '…'}</span>)}</div>)}
    {!ask.isError && <Spinner className="mt-1" />}
    <ErrorNote message={ask.error?.message ?? asking?.error ?? undefined} />
  </Step>
}

function who(admins: string[]): string {
  const names = admins.map(nameOf)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'an admin'
}

function NoKitYet() {
  const cloud = useCloud()
  const startOver = useStartOver()
  const { confirming, setConfirming, box } = useConfirming()
  return <div className="flex w-full max-w-[400px] flex-col items-center gap-3">
    <p className="m-0 text-[13px] text-body">No kit yet. Save one on your first {HERE}.</p>
    <Button type="button" variant="secondary" className={PILL} disabled={cloud.isFetching} onClick={() => void cloud.refetch()}>{cloud.isFetching ? 'Checking…' : 'Check again'}</Button>
    <div ref={box} className="flex flex-wrap items-center justify-center gap-2">
      {confirming
        ? <>
          <span className="w-full text-[12px] text-mute">Start over with an empty backup? Other {HERE}s need the new kit.</span>
          <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" variant="danger" className={PILL} disabled={startOver.isPending} onClick={() => startOver.mutate(undefined, { onError: toastError })}>Start over</Button>
        </>
        : <Button type="button" variant="text" className="text-[12px] font-normal text-mute" onClick={() => setConfirming(true)}>Start over</Button>}
    </div>
  </div>
}

function CodeEntry({ onBack }: { onBack: () => void }) {
  const pairing = usePairing(true)
  return <Step art={<span className="grid size-[120px] place-items-center rounded-xl border border-hair bg-white p-1.5 [&_canvas]:size-full!">{pairing.data && <QrCode text={pairing.data.qr} label={`Code to unlock this ${HERE}`} />}</span>} title="Scan this" line="On it: OpenHut › Devices › Add a Mac." back={onBack}>
    <span className="text-[12px] text-mute">Or type</span>
    <span className="font-mono text-[15px] tracking-[.08em] select-all">{pairing.data?.code ?? '…'}</span>
    <ErrorNote message={pairing.error?.message} />
  </Step>
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
  return <Step art={<Mascot kind="kit" size={84} />} title="Recovery kit" line="Drop the file." back={onBack}>
    <div className="flex w-full max-w-[440px] flex-col gap-3">
      {problem && <p role="alert" className={cn('m-0 rounded-xl px-3.5 py-3 text-left text-[13.5px]/[1.45]', problem.tone === 'warn' ? 'bg-warning-subtle text-warning-strong' : 'bg-[color-mix(in_oklch,var(--fail)_10%,transparent)] text-ink')}>{problem.text}</p>}
      <DropZone className="py-5" onText={tryKit}>{(hot) => <>
        <Hut key={problem?.text} mood={unlock.isPending ? 'key' : hot ? 'surprised' : problem ? 'worried' : 'looking'} className={cn('calm mb-1 size-12', unlock.isPending && 'key-turn', problem && !hot && 'blink-slow')} />
        <span className="text-[15px] font-medium text-ink">{unlock.isPending ? 'Unlocking…' : 'Drop your kit here'}</span>
        {!unlock.isPending && <span className="text-[12.5px] text-mute">or paste it</span>}
      </>}</DropZone>
      <span className="text-[12.5px] text-mute">No file? <Button type="button" variant="text" className="h-auto p-0 text-[12.5px] font-normal text-ink underline underline-offset-2" onClick={() => setTyping(true)}>Type the words</Button></span>
    </div>
  </Step>
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
  return <Step art={<Hut key={typo?.text} mood={typo ? 'worried' : 'key'} className={cn('calm size-[96px]', typo && 'blink-slow')} />} title="12 words" line="In order." back={onBack}
    action={<Button type="submit" form="kit-words" variant="primary" disabled={words.some((word) => !word) || unlock.isPending} className={PRIMARY}>{unlock.isPending ? 'Unlocking…' : 'Unlock'}</Button>}>
    <form id="kit-words" onSubmit={submit} className="flex w-full flex-col items-center gap-3">
      <div className="grid w-full max-w-[440px] grid-cols-3 gap-2">{words.map((word, index) => <label key={index} className={cn('flex h-10 items-center gap-2 rounded-xl border border-hair bg-card px-3 text-[13px] focus-within:border-ink', typo?.at === index && 'border-fail text-fail focus-within:border-fail')}>
        <span className="w-4 text-[11px] text-mute tabular-nums">{index + 1}</span>
        <Input className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[13px] text-inherit focus-visible:outline-none" value={word} autoFocus={index === 0} autoComplete="off" spellCheck={false} aria-label={`Word ${index + 1}`} aria-invalid={typo?.at === index || undefined} onChange={(event) => set(event.target, index)} onPaste={paste} />
      </label>)}</div>
      <ErrorNote className="w-full max-w-[440px] text-left" message={typo?.text ?? unlock.error?.message} />
    </form>
  </Step>
}

export function CloudGate({ children }: { children: ReactNode }) {
  const cloud = useCloud().data
  const queries = useQueryClient()
  const path = usePath()
  const [landing, setLanding] = useState(false)
  const [notified, setNotified] = useState<boolean>()
  const locked = cloud?.status === 'locked'
  useEffect(() => {
    if (!locked) return setNotified(undefined)
    void notifyUnlock().then(setNotified)
  }, [locked])
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
  return <>{children}<Toasts>{cloud.status === 'locked' && notified === false && !path.startsWith('/settings/') && <LockedToast />}<NewMacAlert cloud={cloud} /><Mismatch /></Toasts><GoneNotice cloud={cloud} /><Joins cloud={cloud} /></>
}

function LockedToast() {
  if (isPhone()) return <Toast lead={<Hut mood="key" className="size-8" />} title={`Unlock OpenHut on your ${HERE}`} note="Your agents come back here after that." />
  return <Toast lead={<Hut mood="key" className="size-8" />} title="Unlock OpenHut Cloud" note={`Bring your agents and chats to this ${HERE}.`}><Button type="button" variant="secondary" className={PILL} onClick={() => navigate('/settings/backup?open=enable')}>Unlock</Button></Toast>
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

export function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>OpenHut</div>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
  </div>
}
