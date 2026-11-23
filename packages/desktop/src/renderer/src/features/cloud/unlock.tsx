import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Alert02Icon, Cancel01Icon, FingerPrintIcon, Key01Icon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { kitWord, nearestWord, readKit, validKit } from '@openhut/common/vault/kit-file.ts'
import { agentPath } from '@/app/routes'
import { DeviceIcon } from '@/components/custom/device'
import { DropZone } from '@/components/custom/drop-zone'
import { PersonFace } from '@/components/custom/person-face'
import { AMBER, notify, Tinted, useStickyToast } from '@/components/custom/toast'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nameOf, notifyDesktop, useCloud, usePasskeys, usePasskeyUnlock, useSignIn, useSignOut, useUnlock } from '@/features/cloud/api'
import { BIG, Step } from '@/features/cloud/step'
import { chooseWorkspace, useAsk, useCancelAsk, useDeleteData } from '@/features/cloud/workspaces'
import { Mismatch } from '@/features/cloud/presence'
import { joinRequests } from '@/features/cloud/seen'
import { Spinner } from '@/components/ui/spinner'
import { navigate, usePath } from '@/lib/router'
import { longDate } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function Unlock({ cloud, back }: { cloud: Cloud; back?: () => void }) {
  const [way, setWay] = useState<'kit' | 'ask' | 'start-over' | null>(null)
  const signOut = useSignOut()
  const signIn = useSignIn()
  const helper = usePasskeys()
  const passkey = usePasskeyUnlock()
  const leave = <Button type="button" variant="text" className="font-normal text-mute" disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
  if (cloud.needsSignIn) return <Step title="This computer was removed." line="Sign in again to unlock it." link={leave}
    action={<Button type="button" variant="primary" className={BIG} disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}>Sign in again</Button>} />
  if (way === 'kit') return <KitEntry cloud={cloud} onBack={() => setWay(null)} />
  if (way === 'start-over') return <StartOver onBack={() => setWay(null)} />
  if (way === 'ask' || cloud.asking) return <Requested cloud={cloud} onBack={() => setWay(null)} />
  const macCan = Boolean(helper?.passkeys && helper.prf)
  const canPasskey = macCan && cloud.passkey
  const ask = cloud.canAsk ? 'Approve it from a computer you already use, or use your recovery kit.' : 'Use your recovery kit to unlock it.'
  const lost = <Button type="button" variant="text" className="font-normal text-mute" onClick={() => setWay('start-over')}>Lost your computers and kit? Start over</Button>
  return <Step title={`Welcome back, ${nameOf(cloud.email ?? '')}`} line={`This computer is new to your account. ${ask}`} back={back} link={<span className="flex flex-col items-center gap-1">{leave}{lost}</span>}
    action={<div className="flex flex-col items-center gap-2.5">
      {cloud.canAsk && <Button type="button" variant="primary" className={BIG} onClick={() => setWay('ask')}>Ask my other computer</Button>}
      {cloud.kitInCloud && <Button type="button" variant={cloud.canAsk ? 'secondary' : 'primary'} className={cloud.canAsk ? BIG : BIG} onClick={() => setWay('kit')}><I icon={Key01Icon} size={16} />Use my recovery kit</Button>}
      {canPasskey && <Button type="button" variant="secondary" className={BIG} disabled={passkey.isPending} onClick={() => passkey.mutate(undefined, { onError: toastError })}><I icon={FingerPrintIcon} size={16} />{passkey.isPending ? 'Unlocking…' : 'Use Touch ID'}</Button>}
      {cloud.passkey && !macCan && helper && !helper.error && <span className="text-[12px] text-mute">Touch ID isn’t available here.</span>}
    </div>} />
}

function StartOver({ onBack }: { onBack: () => void }) {
  const remove = useDeleteData()
  return <Step title="Start over?" line="This deletes your account and everything in it, then starts fresh. It can’t be undone: your data was encrypted on your devices, so nobody can recover it." back={onBack}
    action={<Button type="button" variant="destructive" className={BIG} disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onError: toastError })}>{remove.isPending ? 'Deleting…' : 'Delete and start over'}</Button>}>
    <ErrorNote message={remove.error?.message} />
  </Step>
}

function Requested({ cloud, onBack }: { cloud: Cloud; onBack: () => void }) {
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
  const admins = rooms.filter((room) => !room.own).flatMap((room) => room.admins)
  const own = rooms.some((room) => room.own)
  const where = [own && 'on another of your computers, in Settings › Computers', admins.length > 0 && `by ${who(admins)}`].filter(Boolean).join(', or ')
  if (asking?.denied) return <Step title="Not approved." line="It was denied, or the request expired after an hour." back={back}
    action={<Button type="button" variant="primary" className={BIG} disabled={ask.isPending} onClick={() => ask.mutate(undefined, { onError: toastError })}>Request again</Button>} />
  return <Step title="Waiting for approval." line={rooms.length ? 'It unlocks by itself once approved.' : 'Sending your request…'}
    link={<Button type="button" variant="text" className="font-normal text-mute" disabled={cancel.isPending} onClick={back}>Cancel</Button>}>
    <span className="flex items-center gap-2 rounded-xl border border-hair bg-card px-3.5 py-2.5 text-[13px]"><DeviceIcon kind="mac" />{asking?.name ?? 'This computer'}<span className="text-mute">· {cloud.email}</span></span>
    {!ask.isError && <Spinner className="mt-1" />}
    <ErrorNote message={ask.error?.message ?? asking?.error ?? undefined} />
    {rooms.length > 0 && <span className="max-w-[420px] text-[12.5px] text-mute">Approve it {where}.</span>}
  </Step>
}

function who(admins: string[]): string {
  const names = admins.map(nameOf)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'an admin'
}

function JoinRequests({ cloud }: { cloud: Cloud }) {
  const [dismissed, setDismissed] = useState<string[]>([])
  const pending = joinRequests({ cloud })
  const told = useRef(new Set<string>())
  useEffect(() => {
    for (const { workspace, request, mine, path } of pending) {
      if (told.current.has(request.device)) continue
      told.current.add(request.device)
      if (!document.hasFocus()) notifyDesktop({ title: `${request.name ?? 'A new computer'} wants to join`, body: mine ? 'Approve or deny it in Settings › Computers.' : `${nameOf(request.email)} asked to join ${workspace.name}.`, path })
    }
  }, [pending])
  const here = usePath()
  const shown = pending.find(({ request, path }) => path !== here && !dismissed.includes(request.device))
  const later = (device: string) => setDismissed((all) => [...all, device])
  useStickyToast({ id: 'join-request', notice: shown ? {
    lead: <DeviceIcon kind="mac" />,
    title: `${shown.request.name ?? 'A new computer'} wants to join`,
    note: shown.mine ? shown.request.email : `${nameOf(shown.request.email)} · ${shown.workspace.name}`,
    action: { label: 'Open', onClick: () => {
      if (!shown.mine) chooseWorkspace(shown.workspace.id)
      later(shown.request.device)
      navigate(shown.path)
    } },
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
    if (!kit.valid) return setProblem({ tone: 'fail', text: 'One of the words in this kit got changed, so it can’t open your cloud. Try another copy, or type the words instead.' })
    setProblem(undefined)
    unlock.mutate({ words: kit.words }, { onError: (err) => setProblem({ tone: 'fail', text: err.message }) })
  }
  if (typing) return <KitWordsEntry onBack={() => setTyping(false)} />
  return <Step title="Use your recovery kit." line="Drop the file here." back={onBack}>
    <div className="flex w-full max-w-[440px] flex-col gap-3">
      {problem && <p role="alert" className={cn('m-0 rounded-xl px-3.5 py-3 text-left text-[13.5px]/[1.45]', problem.tone === 'warn' ? 'bg-warning-subtle text-warning-strong' : 'bg-[color-mix(in_oklch,var(--fail)_10%,transparent)] text-ink')}>{problem.text}</p>}
      <DropZone className="py-5" onText={tryKit}>{() => <>
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
  return <Step title="Type your 12 words." line="In order." back={onBack}
    action={<Button type="submit" form="kit-words" variant="primary" disabled={words.some((word) => !word) || unlock.isPending} className={BIG}>{unlock.isPending ? 'Unlocking…' : 'Unlock'}</Button>}>
    <form id="kit-words" onSubmit={submit} className="flex w-full flex-col items-center gap-3">
      <div className="grid w-full max-w-[440px] grid-cols-3 gap-2">{words.map((word, index) => <label key={index} className={cn('flex h-10 items-center gap-2 rounded-xl border border-hair bg-card px-3 text-[13px] focus-within:border-ink', typo?.at === index && 'border-fail text-fail focus-within:border-fail')}>
        <span className="w-4 text-[11px] text-mute tabular-nums">{index + 1}</span>
        <Input className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[13px] text-inherit focus-visible:outline-none" value={word} autoFocus={index === 0} autoComplete="off" spellCheck={false} aria-label={`Word ${index + 1}`} aria-invalid={typo?.at === index || undefined} onChange={(event) => set(event.target, index)} onPaste={paste} />
      </label>)}</div>
      <ErrorNote className="w-full max-w-[440px] text-left" message={typo?.text ?? unlock.error?.message} />
    </form>
  </Step>
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
    notify(problem ? { lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: 'Not everything came back', note: problem } : { title: 'Your agents are restored', note: 'Your agents and chats are on this computer now.' })
    navigate(agent ? agentPath({ agentId: agent }) : '/', true)
  }, [restoring, landing, agent, problem, queries])
  if (!cloud) return null
  return <><JoinRequests cloud={cloud} /><Mismatch /><GoneNotice cloud={cloud} /><Joins cloud={cloud} /></>
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
    notify({ lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: last.why === 'deleted' ? `${last.name} was deleted` : `You were removed from ${last.name}`, note: 'Its agents moved to the trash on this computer.' })
  }, [cloud.gone, cloud.workspaces])
  return null
}
