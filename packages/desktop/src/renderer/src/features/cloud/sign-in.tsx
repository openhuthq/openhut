import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft01Icon, CloudIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
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
import { enableCloud, useCloud, useNewKit, useSignIn, useSigningIn } from '@/features/cloud/api'
import { HERE } from '@/features/settings/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { navigate, open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import team from './team.png'

const INK = '#0b0b0b'
const LEARN = 'https://openhut.dev/docs/cloud'

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

export function CloudOff() {
  return <Pane>
    <span className="flex items-end justify-center gap-2">
      <Creature id="helpdesk-1" size={56} />
      <Hut mood="key" className="mx-1 size-[84px]" />
      <Creature id="sales-2" size={56} />
    </span>
    <Title>Your agents, everywhere</Title>
    <YouVsUs />
    <Features />
    <EnableCloud />
  </Pane>
}

export function SignUpIn({ error }: { error?: string }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  return <Pane back={() => open()}>
    <Hut mood="key" className="size-[84px]" />
    <Title>Sign up or sign in</Title>
    <Lead>Use your Google account. Only your email is shared with us.</Lead>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[280px] justify-center gap-2 text-[14px]" disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}><Google size={14} />Continue with Google</Button>
    {waiting && <span className="text-[12.5px] text-mute">Finish in your browser, then come back here.</span>}
    <ErrorNote message={error} />
  </Pane>
}

export function Welcome({ cloud }: { cloud: Cloud }) {
  const { state, done, total } = cloud.backup
  const busy = state === 'backing_up'
  return <Pane>
    <Hut mood="party" className="size-[84px]" />
    <Title>OpenHut Cloud is on</Title>
    <span className="-mt-1 flex items-center gap-1.5 text-[12.5px] text-mute"><Google />Signed in as {cloud.email}</span>
    <div className="mt-2 w-full max-w-[420px] text-left">
      <Rows>
        <Row icon={<Mascot kind="backup" size={26} />} title={busy ? 'Backing up your agents' : 'Your agents are backed up'} note={busy ? `${done} of ${total}` : `Lose this ${HERE}, keep everything.`} />
        <Row icon={<I icon={SquareLock02Icon} size={20} className="text-hue-amber" />} title="Private, even from us" note="We store it, but we can’t read it." />
        <Row icon={<Mascot kind="kit" size={26} />} title="Next: save your recovery kit" note={`It gets you back in on a new ${HERE}. We can’t reset it.`} />
      </Rows>
    </div>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[280px] justify-center text-[14px]" onClick={() => open(cloud.kit ? undefined : 'kit')}>{cloud.kit ? 'Done' : 'Save your recovery kit'}</Button>
  </Pane>
}

export function NeedsCloud({ title, note }: { title: string; note: string }) {
  return <div className="flex flex-col items-center gap-3 px-2 pt-2 pb-2 text-center">
    <img src={team} alt="" width={420} height={140} className="mix-blend-multiply" />
    <span className="text-[18px]/[1.3] font-semibold">{title}</span>
    <Lead>{note}</Lead>
    <div className="mt-1 flex gap-2"><EnableCloud /></div>
  </div>
}

export function EnableCloud({ short }: { short?: boolean }) {
  const locked = useCloud().data?.status === 'locked'
  if (isPhone()) return <span className="text-[13px] text-mute">Enable OpenHut Cloud from OpenHut on your {HERE}.</span>
  return <Button type="button" variant={short ? 'secondary' : 'primary'} className={short ? `${PILL} gap-1.5` : 'gap-1.5'} onClick={() => locked ? navigate('/settings/cloud') : enableCloud()}><I icon={CloudIcon} size={short ? 14 : 15} />{locked ? 'Unlock cloud' : 'Enable cloud'}</Button>
}

function YouVsUs() {
  return <p className="m-0 inline-flex max-w-[620px] items-center justify-center gap-2 text-center text-[14px]/[21px] text-body">
    <I icon={SquareLock02Icon} size={16} className="mt-[2px] shrink-0 text-ink" />
    <span>We store your data, but we can't read it. <a href={LEARN} target="_blank" rel="noreferrer" className="whitespace-nowrap text-ink underline underline-offset-2">Read more</a></span>
  </p>
}

function Features() {
  const rows: ['backup' | 'sync' | 'team', string, string][] = [
    ['backup', 'Backups', 'Lose your Mac, keep everything.'],
    ['sync', 'Sync', 'Same agents on every Mac and your phone.'],
    ['team', 'Teams', 'Share agents with coworkers.'],
  ]
  return <div className="w-full max-w-[420px] text-left"><Rows>{rows.map(([kind, title, note]) => <Row key={title} icon={<Mascot kind={kind} size={28} />} title={title} note={note} />)}</Rows></div>
}

type KitBridge = { save: (input: { name: string; body: string }) => Promise<{ canceled?: boolean; text?: string }> }
const kitBridge: KitBridge | undefined = Reflect.get(window, 'openhut')?.kit
type Step = 'save' | 'paste' | 'drop' | 'words' | 'type' | 'done'
const LINK = 'h-auto p-0 text-[12.5px] font-normal text-ink underline underline-offset-2'
const BIG = 'mt-2 h-10 w-[240px] justify-center text-[14px]'

export function SaveKit() {
  const cloud = useCloud().data
  const make = useNewKit()
  const [kit, setKit] = useState<RecoveryKit>()
  const [replaced, setReplaced] = useState(false)
  const [step, setStep] = useState<Step>('save')
  const [error, setError] = useState<string>()
  const email = cloud?.email ?? ''
  const old = Boolean(cloud?.kit && !cloud.kit.differs)
  const young = cloud?.youngUntil
  const name = `OpenHut Recovery Kit (${email}).txt`
  const textOf = (made: RecoveryKit) => kitText({ email, madeAt: made.madeAt, device: made.device, kitId: made.kitId, words: made.words })
  const same = (other: string | undefined) => Boolean(kit) && readKit(other ?? '')?.words.join(' ') === kit?.words.join(' ')
  const go = (next: Step) => {
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
    go('done')
  }
  const copy = async () => {
    if (await copyText(textOf(await ready()))) go('paste')
  }
  const check = (pasted: string) => same(pasted) ? go('done') : setError(readKit(pasted) ? 'That’s a different kit. Use the one you just saved.' : 'That doesn’t look like your kit. Try again.')
  if (step === 'done') return <KitKept />
  if (step === 'words' && kit) return <KitWords kit={kit} replaced={replaced} onBack={isPhone() ? undefined : () => go('save')} onSaved={() => go('type')} />
  if (step === 'type' && kit) return <ConfirmKit kit={kit} onBack={() => go('words')} onDone={() => go('done')} />
  if (step === 'paste' || step === 'drop') return <KitCheck how={step} error={error} onText={check} onBack={() => go('save')} />
  return <Pane back={() => open()}>
    <Mascot kind="kit" size={92} alive />
    <Title>{old && !kit ? 'Make a new recovery kit' : 'Save your recovery kit'}</Title>
    <Lead>One small file. With your Google account, it opens your cloud on a new {HERE}. We can’t reset it.</Lead>
    {old && !kit && <p className="m-0 font-medium text-ink">{cloud?.passkey ? 'Your old kit and Touch ID stop working.' : 'Your old kit stops working.'}</p>}
    {young
      ? <p className="m-0 max-w-[420px] text-[12.5px] text-mute">This {HERE} was added less than 3 days ago, so it can’t make a kit yet. Make one from an older device, or wait until {shortDate.format(new Date(young))}.</p>
      : <>
        <Button type="button" variant="primary" className={BIG} disabled={make.isPending} onClick={() => run(isPhone() ? async () => { await ready(); go('words') } : save)}>{isPhone() ? 'Show the words' : 'Save kit…'}</Button>
        <ErrorNote message={error} />
        {!isPhone() && <span className="text-[12.5px] text-mute">Rather <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(copy)}>copy it</Button> or <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(async () => { await ready(); go('words') })}>write it down</Button>?</span>}
      </>}
  </Pane>
}

function KitCheck({ how, error, onText, onBack }: { how: 'paste' | 'drop'; error?: string; onText: (text: string) => void; onBack: () => void }) {
  return <Pane back={onBack}>
    <Title>{how === 'paste' ? 'Paste it back' : 'Drop it back'}</Title>
    <Lead>{how === 'paste' ? 'Paste it back here so we know it’s saved.' : 'Drop the file back here so we know it’s saved.'}</Lead>
    <DropZone className="mt-2 w-full max-w-[420px]" onText={onText}>{(hot) => <>
      <Hut mood={hot ? 'surprised' : 'looking'} className="calm mb-1 size-14" />
      <span className="font-medium text-ink">{how === 'paste' ? 'Paste it here' : 'Drop your kit here'}</span>
      <span className="text-[12.5px] text-mute">{how === 'paste' ? 'or drop the file' : 'or paste it'}</span>
    </>}</DropZone>
    <ErrorNote message={error} />
  </Pane>
}

function KitKept() {
  return <Pane>
    <span className="relative">
      <Hut className="calm blink-once size-[84px]" />
      <svg viewBox="0 0 20 20" className="sparkle absolute -top-1 -right-3 size-5" aria-hidden><path d="M10 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="#f7c948" stroke="#0b0b0b" strokeWidth={1.6} strokeLinejoin="round" /></svg>
    </span>
    <Title>Got it. Your kit is safe.</Title>
    <Lead>Keep it somewhere only you can reach, like a password manager.</Lead>
    <Button type="button" variant="primary" className={BIG} autoFocus onClick={() => open()}>Done</Button>
  </Pane>
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
  return <Pane back={onBack}>
    <Title>Write down your words</Title>
    <Lead>They open your cloud on a new {HERE}. We can't reset them.</Lead>
    {replaced && <p className="m-0 font-medium text-ink">Your old recovery words stop working now.</p>}
    <div className="mt-1 grid w-full max-w-[420px] grid-cols-3 gap-2 text-left phone:grid-cols-2">{kit.words.map((word, index) => <span key={index} className="flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 font-mono text-[13px]"><span className="w-4 text-right text-[11px] text-mute">{index + 1}</span>{word}</span>)}</div>
    <div className="mt-2 flex gap-2"><CopyButton text={numbered(kit)} label="Copy" /><Button type="button" variant="primary" onClick={onSaved}>I wrote them down</Button></div>
  </Pane>
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
  return <Pane back={onBack}>
    <Title>Check your words</Title>
    <Lead>Type two of the words so we know you have them.</Lead>
    <form onSubmit={submit} className="mt-1 flex w-full max-w-[320px] flex-col gap-3 text-left">
      {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
      <ErrorNote message={wrong ? 'Those words don’t match your kit. Check the numbers and try again.' : undefined} />
      <Button type="submit" variant="primary" className="h-10 justify-center text-[14px]">Done</Button>
    </form>
  </Pane>
}

function Smile({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx={-11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <ellipse cx={11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <g className="m-eyes"><circle cx={-6} cy={0} r={2.6} fill={INK} /><circle cx={6} cy={0} r={2.6} fill={INK} /></g>
    <path d="M-4 5q4 4 8 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
  </g>
}

export function Mascot({ kind, size, alive }: { kind: 'phone' | 'kit' | 'backup' | 'sync' | 'team'; size: number; alive?: boolean }) {
  const line = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const }
  return <svg width={size} height={size} viewBox="0 0 100 100" className={alive ? 'kit-alive shrink-0' : 'shrink-0'} aria-hidden>
    {kind === 'phone' && <><rect x={28} y={10} width={44} height={80} rx={11} fill="#19B3B1" {...line} /><rect x={35} y={20} width={30} height={54} rx={5} fill="#fbe3c8" /><Smile x={50} y={45} /><circle cx={50} cy={82} r={2.5} fill={INK} /></>}
    {kind === 'kit' && <><rect x={18} y={20} width={50} height={62} rx={7} fill="#fbe3c8" {...line} /><Smile x={43} y={42} /><path d="M30 62h26M30 70h18" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={0.35} /><g className="m-key"><circle cx={74} cy={38} r={10} fill="#f7c948" {...line} /><path d="M74 48v28m0-8h7m-7-8h6" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" /></g></>}
    {kind === 'backup' && <><path d="M28 74h46a16 16 0 0 0 0-32a22 22 0 0 0-42-4a18 18 0 0 0-4 36z" fill="#fff" {...line} /><Smile x={51} y={56} /></>}
    {kind === 'sync' && <><rect x={12} y={26} width={54} height={38} rx={6} fill="#3d8fdc" {...line} /><rect x={18} y={32} width={42} height={26} rx={3} fill="#fbe3c8" /><Smile x={39} y={45} s={0.8} /><path d="M6 72h66" {...line} strokeLinecap="round" /><rect x={66} y={40} width={24} height={42} rx={6} fill="#19B3B1" {...line} /><Smile x={78} y={60} s={0.55} /></>}
    {kind === 'team' && <><circle cx={26} cy={58} r={17} fill="#ff7a59" {...line} /><Smile x={26} y={58} s={0.7} /><circle cx={74} cy={58} r={17} fill="#19B3B1" {...line} /><Smile x={74} y={58} s={0.7} /><circle cx={50} cy={50} r={20} fill="#f7c948" {...line} /><Smile x={50} y={50} s={0.8} /></>}
  </svg>
}

function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
