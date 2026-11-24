import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Alert02Icon, Cancel01Icon, File01Icon, FingerPrintIcon, Key01Icon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { kitWord, nearestWord, readKit, validKit } from '@openhut/common/vault/kit-file.ts'
import { agentPath } from '@/app/routes'
import { DeviceIcon } from '@/components/custom/device'
import { joinedNote } from '@/features/settings/computers'
import { DropZone } from '@/components/custom/drop-zone'
import { PersonFace } from '@/components/custom/person-face'
import { AMBER, notify, Tinted, useStickyToast } from '@/components/custom/toast'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cancelPasskey, knockDesktop, nameOf, notifyDesktop, PasskeyQuiet, useAddPasskey, useCloud, usePasskeys, usePasskeyUnlock, useRemoveMac, useSignIn, useSignOut, useUnlock } from '@/features/cloud/api'
import { BIG, EntryScreen, INK, QUIET } from '@/features/cloud/step'
import { Back } from '@/features/cloud/sign-in'
import { WORDS } from '@/lib/platform'
import { chooseWorkspace, useAsk, useCancelAsk, useDeleteData, useDeny, useReview } from '@/features/cloud/workspaces'
import { Mismatch } from '@/features/cloud/presence'
import { joinRequests, knownDevices, newDevices, rememberDevices } from '@/features/cloud/seen'
import { askedAgo, kindOf, Knocking, placeOf } from '@/features/cloud/knock'
import { RequestError } from '@/lib/api-client'
import { Spinner } from '@/components/ui/spinner'
import { navigate, usePath } from '@/lib/router'
import { dismissGone, goneKey, goneNotice } from '@/features/cloud/seen'
import { longDate } from '@/lib/format'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function Unlock({ cloud, back }: { cloud: Cloud; back?: () => void }) {
  const [way, pick] = useState<'kit' | 'ask' | 'start-over' | null>(null)
  const prompted = useRef(false)
  const signOut = useSignOut()
  const signIn = useSignIn()
  const helper = usePasskeys()
  const passkey = usePasskeyUnlock()
  const leave = <Button type="button" variant="text" className={QUIET} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Use another account</Button>
  const macCan = Boolean(helper?.passkeys && helper.prf)
  const canPasskey = macCan && cloud.passkey
  const touch = (quiet: boolean) => passkey.mutate(quiet, { onError: (error) => { if (!(error instanceof PasskeyQuiet)) toastError(error) } })
  const setWay = (next: typeof way) => {
    if (passkey.isPending) cancelPasskey()
    pick(next)
  }
  useEffect(() => {
    if (!canPasskey || prompted.current || cloud.needsSignIn || cloud.asking) return
    prompted.current = true
    touch(true)
  })
  if (cloud.needsSignIn) return <EntryScreen mood="worried" title="This computer was removed." line="If that was a mistake, sign in again and ask one of your computers." foot={leave}
    waiting={signIn.isPending && 'Finish in your browser'} action={<Button type="button" variant="primary" className={BIG} onClick={() => signIn.mutate(undefined, { onError: toastError })}>Sign in again</Button>} />
  if (way === 'kit') return <KitEntry cloud={cloud} onBack={() => setWay(null)} />
  if (way === 'start-over') return <StartOver onBack={() => setWay(null)} />
  if (way === 'ask' || cloud.asking) return <Requested cloud={cloud} onBack={() => setWay(null)} onKit={cloud.kitInCloud ? () => setWay('kit') : undefined} onTouch={canPasskey ? () => { setWay(null); touch(false) } : undefined} />
  const ways = [
    canPasskey && { key: 'touch', label: 'Use Touch ID', icon: FingerPrintIcon, go: () => touch(false) },
    cloud.canAsk && { key: 'ask', label: 'Ask my other computer', go: () => setWay('ask') },
    cloud.kitInCloud && { key: 'kit', label: 'Use my recovery kit', icon: Key01Icon, go: () => setWay('kit') },
  ].filter((each) => each !== false)
  const [first, ...rest] = ways
  return <EntryScreen title={`Welcome back, ${nameOf(cloud.email ?? '')}.`} line={`This ${WORDS.here} is new to your account.`}
    foot={<>{back && <Back onClick={back} />}{leave}<Button type="button" variant="text" className={QUIET} onClick={() => setWay('start-over')}>Start over</Button></>}
    waiting={passkey.isPending && 'Waiting for Touch ID…'}
    action={<>
      {first && <Button type="button" variant="primary" className={BIG} onClick={first.go}>{first.icon && <I icon={first.icon} size={16} />}{first.label}</Button>}
      {rest.length > 0 && <span className="flex flex-wrap justify-center gap-x-[18px] gap-y-1">{rest.map((each) => <Button key={each.key} type="button" variant="text" className={INK} onClick={each.go}>{each.label}</Button>)}</span>}
    </>}>
    {cloud.passkey && !macCan && helper && !helper.error && <span className="text-[12.5px] text-mute">Touch ID isn’t available here.</span>}
  </EntryScreen>
}

function StartOver({ onBack }: { onBack: () => void }) {
  const remove = useDeleteData()
  const email = useCloud().data?.email
  return <EntryScreen mood="worried" title="Start over?" line="This deletes your account and everything in it. Nobody can get it back." foot={<Back onClick={onBack} />}
    waiting={remove.isPending && 'Deleting your account…'} action={<Button type="button" variant="destructive" className={BIG} onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/', true), onError: toastError })}>{email ? `Delete ${email}` : 'Delete and start over'}</Button>}>
    <ErrorNote message={remove.error?.message} />
  </EntryScreen>
}

function Requested({ cloud, onBack, onKit, onTouch }: { cloud: Cloud; onBack: () => void; onKit?: () => void; onTouch?: () => void }) {
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
  const leaveFor = (next?: () => void) => next && (() => cancel.mutate(undefined, { onSettled: next }))
  const kit = onKit && <Button type="button" variant="text" className={QUIET} onClick={leaveFor(onKit)}>Use my recovery kit</Button>
  const again = <Button type="button" variant="primary" className={BIG} onClick={() => ask.mutate(undefined, { onError: toastError })}>Knock again</Button>
  const other = ask.error instanceof RequestError && ask.error.param === 'waiting'
  if (other) return <EntryScreen mood="worried" title="Another computer is waiting." line={`${ask.error?.message ?? ''} Approve or turn that one down, then ask from here.`}
    foot={<><Back onClick={onBack} />{onKit && <Button type="button" variant="text" className={QUIET} onClick={onKit}>Use my recovery kit</Button>}</>}
    action={onTouch && <Button type="button" variant="primary" className={BIG} onClick={onTouch}><I icon={FingerPrintIcon} size={16} />Use Touch ID</Button>} />
  if (asking?.missed) return <EntryScreen mood="worried" title="Those faces didn’t match." line="The request was turned down. If that was you, ask again. After two misses, wait an hour." foot={<><Back onClick={back} />{kit}</>}
    waiting={ask.isPending && 'Knocking…'} action={again}><ErrorNote message={ask.error?.message} /></EntryScreen>
  const rooms = asking?.rooms ?? []
  const admins = rooms.filter((room) => !room.own).flatMap((room) => room.admins)
  const own = rooms.some((room) => room.own)
  if (asking?.denied) return <EntryScreen mood="worried" title="Nobody let you in." line="The knock was turned down, or 15 minutes passed." foot={<><Back onClick={back} />{kit}</>}
    waiting={ask.isPending && 'Knocking…'} action={again} />
  return <Knocking faces={asking?.faces ?? null} foot={<>{kit}<Button type="button" variant="text" className={QUIET} disabled={cancel.isPending} onClick={back}>Cancel</Button></>}>
    <ErrorNote message={ask.error?.message ?? asking?.error ?? undefined} />
    {admins.length > 0 && <span className="text-[12.5px] text-mute">{own ? `${who(admins)} can let you in too.` : `Ask ${who(admins)} to let you in.`}</span>}
  </Knocking>
}

function who(admins: string[]): string {
  const names = admins.map(nameOf)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'an admin'
}

type Pending = ReturnType<typeof joinRequests>[number]

function knockTitle({ request, mine }: Pending): string {
  const device = request.name ?? 'a new device'
  return mine ? `Someone’s knocking: ${device}` : `${nameOf(request.email)} is knocking: ${device}`
}

function JoinRequests({ cloud }: { cloud: Cloud }) {
  const review = useReview()
  const deny = useDeny()
  const [dismissed, setDismissed] = useState<string[]>([])
  const pending = joinRequests({ cloud })
  const told = useRef(new Set<string>())
  const later = (device: string) => setDismissed((all) => [...all, device])
  const letIn = ({ workspace, request, mine, path }: Pending) => {
    if (!mine) chooseWorkspace(workspace.id)
    later(request.device)
    review.mutate({ id: workspace.id, device: request.device }, { onSuccess: () => navigate(`${path}?open=${encodeURIComponent(`review:${request.device}`)}`), onError: toastError })
  }
  const letInRef = useRef(letIn)
  letInRef.current = letIn
  useEffect(() => {
    for (const each of pending) {
      const { workspace, request, mine } = each
      if (told.current.has(request.device)) continue
      told.current.add(request.device)
      void knockDesktop({ title: knockTitle(each), body: [placeOf(request), kindOf(request), mine ? request.email : workspace.name].filter(Boolean).join(' · ') }).then((action) => {
        if (action === 'open') letInRef.current(each)
        if (action === 'not-me') deny.mutate({ id: workspace.id, device: request.device, why: 'not-me' }, { onSuccess: () => toast('Session signed out'), onError: toastError })
      })
    }
  }, [pending, deny])
  const here = usePath()
  const shown = pending.find(({ request, path }) => path !== here && !dismissed.includes(request.device))
  useStickyToast({ id: 'join-request', notice: shown ? {
    lead: <DeviceIcon kind={shown.request.server ? 'server' : 'mac'} />,
    title: knockTitle(shown),
    note: [placeOf(shown.request), kindOf(shown.request), shown.mine ? shown.request.email : `${nameOf(shown.request.email)} · ${shown.workspace.name}`, `asked ${askedAgo(shown.request.at)}`].filter(Boolean).join(' · '),
    action: { label: 'Let it in', onClick: () => letIn(shown) },
    cancel: { label: 'Later', onClick: () => later(shown.request.device) },
  } : null })
  return null
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
    if (!kit.valid) return setProblem({ tone: 'fail', text: 'This kit has a wrong word. Try another copy, or type the words.' })
    setProblem(undefined)
    unlock.mutate({ words: kit.words }, { onError: (err) => setProblem({ tone: 'fail', text: err.message }) })
  }
  if (typing) return <KitWordsEntry onBack={() => setTyping(false)} onFile={() => setTyping(false)} />
  return <EntryScreen mood="key" title="Use your recovery kit." line="Drop the file anywhere on this window." foot={<><Button type="button" variant="text" className={QUIET} onClick={() => setTyping(true)}>Type the words instead</Button><Back onClick={onBack} /></>}
    waiting={unlock.isPending && 'Unlocking…'} action={<label htmlFor={KIT_FILE} className={cn(buttonVariants({ variant: 'primary' }), BIG, 'cursor-pointer')}>Choose file</label>}>
    {problem && <p role="alert" className={cn('m-0 w-full rounded-xl px-3.5 py-3 text-left text-[13.5px]/[1.45]', problem.tone === 'warn' ? 'bg-warning-subtle text-warning-strong' : 'bg-[color-mix(in_oklch,var(--fail)_10%,transparent)] text-ink')}>{problem.text}</p>}
    <DropZone id={KIT_FILE} window className="gap-1 border-0 bg-soft py-[26px] text-[13px] text-mute hover:border-0" onText={tryKit}>{() => <>
      <I icon={File01Icon} size={26} className="text-hue-amber" />
      <span className="text-[15px] font-medium text-ink">OpenHut Recovery Kit.txt</span>
      or paste its text
    </>}</DropZone>
  </EntryScreen>
}

const KIT_FILE = 'kit-file'

function KitWordsEntry({ onBack, onFile }: { onBack: () => void; onFile: () => void }) {
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
  return <EntryScreen mood="key" title="Type your 12 words." line="In order. Paste works too." foot={<><Button type="button" variant="text" className={QUIET} onClick={onFile}>Use the file instead</Button><Back onClick={onBack} /></>}
    waiting={unlock.isPending && 'Unlocking…'} action={<Button type="submit" form="kit-words" variant="primary" disabled={words.some((word) => !word)} className={BIG}>Unlock</Button>}>
    <form id="kit-words" onSubmit={submit} className="flex w-full flex-col items-center gap-3">
      <div className="grid w-full grid-cols-3 gap-1.5 phone:grid-cols-2">{words.map((word, index) => <label key={index} className={cn('flex h-9 items-center gap-2 rounded-lg border border-mid bg-card px-2.5 font-mono text-[13px] focus-within:border-2 focus-within:border-ink focus-within:px-[9px]', typo?.at === index && 'border-fail text-fail focus-within:border-fail')}>
        <span className="w-3.5 text-right font-sans text-[11px] text-mute tabular-nums">{index + 1}</span>
        <Input className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 font-mono text-[13px] text-inherit focus-visible:outline-none" value={word} autoFocus={index === 0} autoComplete="off" spellCheck={false} aria-label={`Word ${index + 1}`} aria-invalid={typo?.at === index || undefined} onChange={(event) => set(event.target, index)} onPaste={paste} />
      </label>)}</div>
      <ErrorNote className="w-full text-left" message={typo?.text ?? unlock.error?.message} />
    </form>
  </EntryScreen>
}

export function CloudToasts() {
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
    notify(problem ? { lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: 'Not everything came back', note: problem } : { title: 'Agents and chats restored' })
    navigate(agent ? agentPath({ agentId: agent }) : '/', true)
  }, [restoring, landing, agent, problem, queries])
  if (!cloud) return null
  return <><JoinRequests cloud={cloud} /><Mismatch /><GoneNotice cloud={cloud} /><TurnedDown cloud={cloud} /><Joins cloud={cloud} /><SelfJoins cloud={cloud} /><TouchIdBack cloud={cloud} /></>
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

function TouchIdBack({ cloud }: { cloud: Cloud }) {
  const helper = usePasskeys()
  const add = useAddPasskey()
  const [later, setLater] = useState(false)
  const shown = cloud.touchIdOff && !later && Boolean(helper?.passkeys && helper.prf)
  useStickyToast({ id: 'touch-id-back', notice: shown ? {
    lead: <I icon={FingerPrintIcon} size={18} />,
    title: 'Turn Touch ID back on?',
    note: 'Reset encryption turned this off. Enable it again here.',
    action: { label: 'Turn on', onClick: () => add.mutate(null, { onSuccess: () => notify({ title: 'Touch ID is on again' }), onError: (error) => { if (!(error instanceof PasskeyQuiet)) toastError(error) } }) },
    cancel: { label: 'Not now', onClick: () => setLater(true) },
  } : null, onDismiss: () => setLater(true) })
  return null
}

const OS_WAIT_MS = 20_000

function SelfJoins({ cloud }: { cloud: Cloud }) {
  const remove = useRemoveMac()
  useEffect(() => {
    if (cloud.status !== 'on') return
    const fresh = newDevices({ devices: cloud.devices, known: knownDevices() })
    const waiting = fresh.filter((device) => !device.os && Date.now() - Date.parse(device.addedAt ?? '') < OS_WAIT_MS)
    rememberDevices(cloud.devices.filter((device) => !waiting.includes(device)).map((device) => device.key))
    for (const device of fresh.filter((each) => !waiting.includes(each))) {
      const name = device.name ?? 'A new computer'
      const recovered = device.joined?.how === 'recovery'
      const kind = device.os ?? (device.kind === 'server' ? 'Linux server' : 'Computer')
      const title = recovered ? `A computer used your ${device.os?.startsWith('macOS') ? 'recovery kit or Touch ID' : 'recovery kit'} to join` : `${name} joined`
      const how = recovered ? name : joinedNote(device.joined)
      notifyDesktop({ title, body: 'If that wasn’t you, open OpenHut and choose Remove.', path: '/settings/computers' })
      notify({ lead: <DeviceIcon kind={device.kind} />, title, note: `${[kind, how, device.addedAt && askedAgo(device.addedAt)].filter(Boolean).join(' · ')}. Not you? Remove and lock it out.`, action: { label: 'Remove', onClick: () => remove.mutate({ key: device.key, lost: true }) } })
    }
  }, [cloud.devices, cloud.status, cloud.email, remove])
  return null
}

function TurnedDown({ cloud }: { cloud: Cloud }) {
  const seen = useRef(new Set(cloud.turnedDown.map((each) => each.at)))
  useEffect(() => {
    for (const each of cloud.turnedDown.filter((one) => !seen.current.has(one.at))) {
      seen.current.add(each.at)
      const title = `A sign-in from ${each.name ?? 'a new device'} was turned down`
      const body = [each.why === 'mismatch' ? 'The faces didn’t match' : 'Someone chose Not me', each.place, each.email].filter(Boolean).join(' · ')
      notifyDesktop({ title, body, path: '/settings/computers' })
      notify({ lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title, note: `${body}. Nothing got in. If this keeps happening, change your Google password.` })
    }
  }, [cloud.turnedDown])
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
    navigate('/', true)
    notify({ lead: <Tinted icon={Alert02Icon} hue={AMBER} />, ...goneNotice(last), onDismiss: () => dismissGone(goneKey(last)) })
  }, [cloud.gone, cloud.workspaces])
  return null
}
