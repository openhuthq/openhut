import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft01Icon, CloudIcon, CloudUploadIcon, ComputerPhoneSyncIcon, Key01Icon, SquareLock02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import type { Cloud, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { kitText, readKit } from '@openhut/common/vault/kit-file.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/copy-button'
import { DropZone } from '@/components/custom/drop-zone'
import { ErrorNote } from '@/components/error-note'
import { Creature } from '@/components/creature'
import { Hut } from '@/components/hut'
import { I, ICON_BUTTON, PILL } from '@/components/kit'
import { enableCloud, nameOf, useCloud, useNewKit, useSignIn, useSigningIn } from '@/features/cloud/api'
import { PRIMARY, Step } from '@/features/cloud/step'
import { HERE } from '@/features/settings/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { open } from '@/lib/router'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import team from './team.png'

const INK = '#0b0b0b'

export function Pane({ back, children }: { back?: () => void; children: ReactNode }) {
  return <div className="relative flex flex-col items-center gap-3 px-6 pt-4 text-center text-[13px]/[18px]">
    {back && <Button type="button" data-back variant="bare" className={cn(ICON_BUTTON, 'absolute -top-1 left-0')} aria-label="Back" title="Back" onClick={back}><I icon={ArrowLeft01Icon} size={16} /></Button>}
    {children}
  </div>
}

export function Title({ children }: { children: ReactNode }) {
  return <span className="mt-1 text-[18px]/[1.3] font-semibold tracking-[-.01em]">{children}</span>
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[460px] text-[13.5px]/[20px] text-body">{children}</p>
}

export type Door = 'backup' | 'people'

const PITCH: Record<Door, { title: string; note: string; action: string }> = {
  backup: { title: 'Lose your Mac, keep everything', note: 'Back up your agents and chats, and use them on your other Macs.', action: 'Back up my agents' },
  people: { title: 'Share agents with your team', note: 'Your team can chat with and edit the agents you share.', action: 'Share with your team' },
}

function Art({ door }: { door: Door }) {
  if (door === 'people') return <img src={team} alt="" width={360} height={120} className="mix-blend-multiply" />
  return <span className="flex items-end justify-center gap-2">
    <Creature id="helpdesk-1" size={52} />
    <Hut mood="key" className="mx-1 size-[84px]" />
    <Creature id="sales-2" size={52} />
  </span>
}

export function Pitch({ door }: { door: Door }) {
  const cloud = useCloud().data
  const locked = cloud?.status === 'locked'
  const pitch = PITCH[door]
  return <Pane>
    {locked ? <Hut mood="key" className="size-[84px]" /> : <Art door={door} />}
    <Title>{locked ? `Welcome back, ${nameOf(cloud.email ?? '')}` : pitch.title}</Title>
    <Lead>{locked ? `Unlock to bring your agents and chats to this ${HERE}.` : pitch.note}</Lead>
    {isPhone()
      ? <span className="text-[13px] text-mute">{locked ? `Unlock OpenHut on your ${HERE}.` : `Set this up in OpenHut on your ${HERE}.`}</span>
      : <Button type="button" variant="primary" className={BIG} onClick={() => open('enable')}>{locked ? 'Unlock' : pitch.action}</Button>}
  </Pane>
}

export function Why({ door, onNext }: { door: Door; onNext: () => void }) {
  const rows: [ReactNode, string, string][] = door === 'people'
    ? [[<I icon={UserGroupIcon} size={20} className="text-hue-amber" />, 'Work on agents together', 'Your team can chat with and edit the agents you share.'], [<I icon={Key01Icon} size={20} className="text-hue-amber" />, 'The rest stay yours', 'Agents you don’t share stay private, even from your team.']]
    : [[<I icon={CloudUploadIcon} size={20} className="text-hue-blue" />, 'Lose your Mac, keep everything', `Agents, chats and settings come back on a new ${HERE}.`], [<I icon={ComputerPhoneSyncIcon} size={20} className="text-hue-blue" />, 'On your other Macs too', 'Chat with the same agents on every Mac you sign in to.']]
  return <Step art={<Art door={door} />} title={door === 'people' ? 'Share agents with your team' : 'Never lose your agents'} action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onNext}>Continue</Button>}>
    <div className="w-full max-w-[420px] text-left">
      <Rows>
        {rows.map(([icon, title, note]) => <Row key={title} icon={icon} title={title} note={note} />)}
        <Row icon={<I icon={SquareLock02Icon} size={20} className="text-hue-amber" />} title="Private, even from us" note="We store it, but we can’t read it." />
      </Rows>
    </div>
  </Step>
}

export function SignUpIn({ back, error }: { back: () => void; error?: string }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  return <Step art={<Hut mood="key" className="size-[96px]" />} title="Sign up or sign in" line="Use your Google account. Only your email is shared with us." back={back}
    action={<Button type="button" variant="primary" className={cn(PRIMARY, 'gap-2')} disabled={signIn.isPending} onClick={() => signIn.mutate()}><Google size={14} />{signIn.isPending ? 'Signing in…' : 'Continue with Google'}</Button>}>
    {(signIn.isPending || waiting) && <span className="text-[12.5px] text-mute">{waiting ? 'Finish in your browser, then come back here.' : 'Finish signing in with Google.'}</span>}
    <ErrorNote message={signIn.error?.message ?? error} />
  </Step>
}

export function MacIsIn({ cloud, door, onNext }: { cloud: Cloud; door: Door; onNext: () => void }) {
  const { state, done, total } = cloud.backup
  const busy = state === 'backing_up'
  return <Step art={<Hut mood="party" className="size-[96px]" />} title={`This ${HERE} is in`} line={<span className="inline-flex items-center gap-1.5"><Google />Signed in as {cloud.email}</span>}
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onNext}>{cloud.kit ? 'Done' : 'Next'}</Button>}>
    <div className="w-full max-w-[420px] text-left">
      <Rows>
        {door === 'people' && <Row icon={<I icon={UserGroupIcon} size={20} className="text-hue-amber" />} title="Your workspace is ready to share" note="Invite people from People when you’re done here." />}
        <Row icon={<I icon={CloudUploadIcon} size={20} className="text-hue-blue" />} title={busy ? 'Backing up your agents' : 'Your agents are backed up'} note={busy ? `${done} of ${total}` : `Lose this ${HERE}, keep everything.`} />
        {!cloud.kit && <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Next: your recovery kit" note={`It gets you back in on a new ${HERE}. We can’t reset it.`} />}
      </Rows>
    </div>
  </Step>
}

export function AllSet({ onDone }: { onDone: () => void }) {
  return <Step art={<span className="relative"><Hut className="calm blink-once size-[96px]" /><svg viewBox="0 0 20 20" className="sparkle absolute -top-1 -right-3 size-5" aria-hidden><path d="M10 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="#f7c948" stroke="#0b0b0b" strokeWidth={1.6} strokeLinejoin="round" /></svg></span>}
    title="You’re all set" line="Keep your kit somewhere only you can reach, like a password manager."
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onDone}>Done</Button>}>
    <div className="w-full max-w-[420px] text-left">
      <Rows>
        <Row icon={<I icon={CloudUploadIcon} size={20} className="text-hue-blue" />} title="Backed up" note={`Your agents and chats, on this ${HERE} and in OpenHut Cloud.`} />
        <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit saved" note={`Your way back in on a new ${HERE}.`} />
      </Rows>
    </div>
  </Step>
}

export function EnableCloud() {
  if (isPhone()) return <span className="text-[13px] text-mute">Set up OpenHut Cloud on your {HERE}.</span>
  return <Button type="button" variant="secondary" className={`${PILL} gap-1.5`} onClick={enableCloud}><I icon={CloudIcon} size={14} />Enable cloud</Button>
}

type KitBridge = { save: (input: { name: string; body: string }) => Promise<{ canceled?: boolean; text?: string }> }
const kitBridge: KitBridge | undefined = Reflect.get(window, 'openhut')?.kit
type KitStep = 'save' | 'paste' | 'drop' | 'words' | 'type'
const LINK = 'h-auto p-0 text-[12.5px] font-normal text-ink underline underline-offset-2'
const BIG = 'mt-2 h-10 w-[240px] justify-center text-[14px]'

export function SaveKit({ onBack, onDone }: { onBack?: () => void; onDone: () => void }) {
  const cloud = useCloud().data
  const make = useNewKit()
  const [kit, setKit] = useState<RecoveryKit>()
  const [replaced, setReplaced] = useState(false)
  const [step, setStep] = useState<KitStep>('save')
  const [error, setError] = useState<string>()
  const email = cloud?.email ?? ''
  const old = Boolean(cloud?.kit && !cloud.kit.differs)
  const young = cloud?.youngUntil
  const name = `OpenHut Recovery Kit (${email}).txt`
  const textOf = (made: RecoveryKit) => kitText({ email, madeAt: made.madeAt, device: made.device, kitId: made.kitId, words: made.words })
  const same = (other: string | undefined) => Boolean(kit) && readKit(other ?? '')?.words.join(' ') === kit?.words.join(' ')
  const go = (next: KitStep) => {
    setError(undefined)
    setStep(next)
  }
  const ready = async () => {
    if (kit) return kit
    const made = await make.mutateAsync()
    setReplaced(old)
    setKit(made)
    return made
  }
  const run = (task: () => Promise<unknown>) => void task().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  const save = async () => {
    const made = await ready()
    const text = textOf(made)
    if (!kitBridge) {
      download({ name, text })
      return go('drop')
    }
    const saved = await kitBridge.save({ name, body: text })
    if (saved.canceled) return
    if (readKit(saved.text ?? '')?.words.join(' ') !== made.words.join(' ')) return setError('The saved file doesn’t match your kit. Save it again.')
    onDone()
  }
  const copy = async () => {
    if (await copyText(textOf(await ready()))) go('paste')
  }
  const words = async () => {
    await ready()
    go('words')
  }
  const check = (pasted: string) => same(pasted) ? onDone() : setError(readKit(pasted) ? 'That’s a different kit. Use the one you just saved.' : 'That doesn’t look like your kit. Try again.')
  if (step === 'words' && kit) return <KitWords kit={kit} replaced={replaced} onBack={isPhone() ? onBack : () => go('save')} onSaved={() => go('type')} />
  if (step === 'type' && kit) return <ConfirmKit kit={kit} onBack={() => go('words')} onDone={onDone} />
  if (step === 'paste' || step === 'drop') return <KitCheck how={step} error={error} onText={check} onBack={() => go('save')} />
  return <Step art={<Mascot kind="kit" size={96} alive />} title={old && !kit ? 'Make a new recovery kit' : 'Save your recovery kit'} line={`One small file. With your Google account, it gets you back in on a new ${HERE}. We can’t reset it.`} back={onBack}
    action={!young && <Button type="button" variant="primary" className={PRIMARY} disabled={make.isPending} onClick={() => run(isPhone() ? words : save)}>{isPhone() ? 'Show the words' : 'Save kit…'}</Button>}>
    {old && !kit && <p className="m-0 font-medium text-ink">{cloud?.passkey ? 'Your old kit and Touch ID stop working.' : 'Your old kit stops working.'}</p>}
    {young && <p className="m-0 max-w-[420px] text-[12.5px] text-mute">This {HERE} was added less than 3 days ago, so it can’t make a kit yet. Make one from an older device, or wait until {shortDate.format(new Date(young))}.</p>}
    <ErrorNote message={error} />
    {!young && !isPhone() && <span className="text-[12.5px] text-mute">Rather <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(copy)}>copy it</Button> or <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(words)}>write it down</Button>?</span>}
  </Step>
}

function KitCheck({ how, error, onText, onBack }: { how: 'paste' | 'drop'; error?: string; onText: (text: string) => void; onBack: () => void }) {
  return <Step art={<Mascot kind="kit" size={72} />} title={how === 'paste' ? 'Paste it back' : 'Drop it back'} line={how === 'paste' ? 'Paste it back here so we know it’s saved.' : 'Drop the file back here so we know it’s saved.'} back={onBack}>
    <DropZone className="w-full max-w-[420px]" onText={onText}>{(hot) => <>
      <Hut mood={hot ? 'surprised' : 'looking'} className="calm mb-1 size-12" />
      <span className="font-medium text-ink">{how === 'paste' ? 'Paste it here' : 'Drop your kit here'}</span>
      <span className="text-[12.5px] text-mute">{how === 'paste' ? 'or drop the file' : 'or paste it'}</span>
    </>}</DropZone>
    <ErrorNote message={error} />
  </Step>
}

function numbered(kit: RecoveryKit): string {
  return kit.words.map((word, index) => `${index + 1}. ${word}`).join('\n')
}

function download({ name, text }: { name: string; text: string }) {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name })
  link.click()
  URL.revokeObjectURL(link.href)
}

function KitWords({ kit, replaced, onBack, onSaved }: { kit: RecoveryKit; replaced: boolean; onBack?: () => void; onSaved: () => void }) {
  return <Step art={<Mascot kind="kit" size={72} />} title="Write down your words" line={replaced ? 'Your old recovery words stop working now.' : `They get you back in on a new ${HERE}. We can't reset them.`} back={onBack}
    action={<span className="flex gap-2"><CopyButton text={numbered(kit)} label="Copy" /><Button type="button" variant="primary" className={PRIMARY} onClick={onSaved}>I wrote them down</Button></span>}>
    <div className="grid w-full max-w-[420px] grid-cols-3 gap-2 text-left phone:grid-cols-2">{kit.words.map((word, index) => <span key={index} className="flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 font-mono text-[13px]"><span className="w-4 text-right text-[11px] text-mute">{index + 1}</span>{word}</span>)}</div>
  </Step>
}

function ConfirmKit({ kit, onBack, onDone }: { kit: RecoveryKit; onBack: () => void; onDone: () => void }) {
  const [wrong, setWrong] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const right = kit.ask.every((index) => String(form.get(`word-${index}`) ?? '').trim().toLowerCase() === kit.words[index])
    if (right) onDone()
    setWrong(!right)
  }
  return <Step art={<Mascot kind="kit" size={72} />} title="Check your words" line="Type two of the words so we know you have them." back={onBack} action={<Button type="submit" form="check-kit" variant="primary" className={PRIMARY}>Check</Button>}>
    <form id="check-kit" onSubmit={submit} className="flex w-full max-w-[320px] flex-col gap-3 text-left">
      {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
      <ErrorNote message={wrong ? 'Those words don’t match your kit. Check the numbers and try again.' : undefined} />
    </form>
  </Step>
}

function Smile({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx={-11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <ellipse cx={11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <g className="m-eyes"><circle cx={-6} cy={0} r={2.6} fill={INK} /><circle cx={6} cy={0} r={2.6} fill={INK} /></g>
    <path d="M-4 5q4 4 8 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
  </g>
}

export function Mascot({ kind, size, alive }: { kind: 'kit'; size: number; alive?: boolean }) {
  const line = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const }
  return <svg width={size} height={size} viewBox="0 0 100 100" className={alive ? 'kit-alive shrink-0' : 'shrink-0'} aria-hidden>
    {kind === 'kit' && <><rect x={18} y={20} width={50} height={62} rx={7} fill="#fbe3c8" {...line} /><Smile x={43} y={42} /><path d="M30 62h26M30 70h18" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={0.35} /><g className="m-key"><circle cx={74} cy={38} r={10} fill="#f7c948" {...line} /><path d="M74 48v28m0-8h7m-7-8h6" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" /></g></>}
  </svg>
}

function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
