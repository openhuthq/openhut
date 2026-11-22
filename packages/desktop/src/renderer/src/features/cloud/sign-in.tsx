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
import { enableCloud, nameOf, useCancelSignIn, useCloud, useNewKit, useSignIn, useSigningIn } from '@/features/cloud/api'
import { toastError } from '@/lib/toast'
import { PRIMARY, Step } from '@/features/cloud/step'
import { Row, Rows } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { navigate, open } from '@/lib/router'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

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

function Characters() {
  return <span className="flex items-end justify-center gap-2">
    <Creature id="helpdesk-1" size={52} />
    <Hut mood="key" className="mx-1 size-[84px]" />
    <Creature id="sales-2" size={52} />
  </span>
}

const ROW_ICON = { blue: 'text-hue-blue', amber: 'text-hue-amber' }

function Benefit({ icon, hue, title, note }: { icon: Parameters<typeof I>[0]['icon']; hue: keyof typeof ROW_ICON; title: string; note?: ReactNode }) {
  return <Row icon={<I icon={icon} size={20} className={ROW_ICON[hue]} />} title={title} note={note} />
}

export function Pitch() {
  const cloud = useCloud().data
  const signIn = useSignIn()
  const waiting = useSigningIn()
  const cancel = useCancelSignIn()
  if (cloud?.status === 'locked') return <Pane>
    <Hut mood="key" className="size-[84px]" />
    <Title>{`You’re signed in, ${nameOf(cloud.email ?? '')}`}</Title>
    <Lead>One more step: the key that reads your agents and chats.</Lead>
    {isPhone() ? <span className="text-[13px] text-mute">Unlock OpenHut on your computer.</span> : <Button type="button" variant="primary" className={BIG} onClick={() => open('enable')}>Unlock</Button>}
  </Pane>
  if (waiting) return <Pane>
    <Hut mood="looking" className="size-[84px]" />
    <Title>Finish signing in in your browser</Title>
    <Lead>This page moves on by itself when you’re done.</Lead>
    <div className="flex flex-col items-center gap-2">
      <Button type="button" variant="primary" className={cn(BIG, 'gap-2')} disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}><Google size={14} />Open the browser again</Button>
      <Button type="button" variant="ghost" className={cn(BIG, 'mt-0')} onClick={cancel}>Cancel</Button>
    </div>
  </Pane>
  return <Pane>
    <Characters />
    <Title>Sign in to see your team</Title>
    <Lead>Or join one with an invite link.</Lead>
    <div className="my-2 w-full max-w-[400px] text-left">
      <Rows>
        <Benefit icon={UserGroupIcon} hue="amber" title="Share agents" note="Your teammates chat with the agents you share" />
        <Benefit icon={ComputerPhoneSyncIcon} hue="blue" title="On every computer" note="Your agents follow you" />
        <Benefit icon={CloudUploadIcon} hue="blue" title="Backed up" note="Lose your computer, keep everything" />
        <Benefit icon={SquareLock02Icon} hue="amber" title="End-to-end encrypted" note="We can’t read your data" />
      </Rows>
    </div>
    {isPhone()
      ? <span className="text-[13px] text-mute">Sign in on your computer.</span>
      : <div className="flex flex-col items-center gap-2">
        <Button type="button" variant="primary" className={cn(BIG, 'gap-2')} disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}><Google size={14} />Sign in with Google</Button>
        <Button type="button" variant="secondary" className={cn(BIG, 'mt-0')} onClick={() => open('join-link')}>Join with a link</Button>
      </div>}
    <ErrorNote message={signIn.error?.message ?? cloud?.signInError ?? undefined} />
  </Pane>
}

export function SignInOnTeam({ what }: { what: string }) {
  return <Pane>
    <Title>Not signed in</Title>
    <Lead>{`Sign in on the Team tab to see ${what}.`}</Lead>
    <Button type="button" variant="secondary" className={PILL} onClick={() => navigate('/settings/team')}>Go to Team</Button>
  </Pane>
}

export function MacIsIn({ cloud, onNext }: { cloud: Cloud; onNext: () => void }) {
  const { state, done, total } = cloud.backup
  const busy = state === 'backing_up'
  return <Step art={<Hut mood="party" className="size-[96px]" />} title="OpenHut Cloud is on" line={<span className="inline-flex items-center gap-1.5"><Google />{cloud.email}</span>}
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onNext}>{cloud.kit ? 'Done' : 'Next'}</Button>}>
    <div className="w-full max-w-[360px] text-left">
      <Rows>
        <Benefit icon={CloudUploadIcon} hue="blue" title={busy ? 'Backing up' : 'Backed up'} note={busy ? `${done} of ${total}` : 'Agents, chats and settings'} />
        {!cloud.kit && <Benefit icon={Key01Icon} hue="amber" title="Next: recovery kit" note="Get back in if you lose this computer" />}
      </Rows>
    </div>
  </Step>
}

export function AllSet({ onDone }: { onDone: () => void }) {
  return <Step art={<span className="relative"><Hut className="calm blink-once size-[96px]" /><svg viewBox="0 0 20 20" className="sparkle absolute -top-1 -right-3 size-5" aria-hidden><path d="M10 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="#f7c948" stroke="#0b0b0b" strokeWidth={1.6} strokeLinejoin="round" /></svg></span>}
    title="All set" line="Keep your recovery kit somewhere safe."
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onDone}>Done</Button>}>
    <div className="w-full max-w-[360px] text-left">
      <Rows>
        <Benefit icon={CloudUploadIcon} hue="blue" title="Backed up" />
        <Benefit icon={Key01Icon} hue="amber" title="Recovery kit saved" />
      </Rows>
    </div>
  </Step>
}

export function EnableCloud() {
  if (isPhone()) return <span className="text-[13px] text-mute">Enable OpenHut Cloud on your computer.</span>
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
  return <Step art={<Mascot kind="kit" size={96} alive />} title={old && !kit ? 'New recovery kit' : 'Recovery kit'} line="Get back in if you lose this computer. We can’t reset it." back={onBack}
    action={!young && <Button type="button" variant="primary" className={PRIMARY} disabled={make.isPending} onClick={() => run(isPhone() ? words : save)}>{isPhone() ? 'Show the words' : 'Save kit'}</Button>}>
    {old && !kit && <p className="m-0 font-medium text-ink">{cloud?.passkey ? 'The old kit and Touch ID stop working.' : 'The old kit stops working.'}</p>}
    {young && <p className="m-0 max-w-[420px] text-[12.5px] text-mute">This computer was added less than 3 days ago. Make a kit after {shortDate.format(new Date(young))}, or on an older one.</p>}
    <ErrorNote message={error} />
    {!young && !isPhone() && <span className="text-[12.5px] text-mute">Or <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(copy)}>copy it</Button> · <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(words)}>write it down</Button></span>}
  </Step>
}

function KitCheck({ how, error, onText, onBack }: { how: 'paste' | 'drop'; error?: string; onText: (text: string) => void; onBack: () => void }) {
  return <Step art={<Mascot kind="kit" size={72} />} title={how === 'paste' ? 'Paste it back' : 'Drop it back'} line="So we know it’s saved." back={onBack}>
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
  return <Step art={<Mascot kind="kit" size={72} />} title="Your 12 words" line={replaced ? 'Your old words stop working now.' : 'Write them down and keep them safe.'} back={onBack}
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
  return <Step art={<Mascot kind="kit" size={72} />} title="Check your words" line="Type two of them." back={onBack} action={<Button type="submit" form="check-kit" variant="primary" className={PRIMARY}>Check</Button>}>
    <form id="check-kit" onSubmit={submit} className="flex w-full max-w-[320px] flex-col gap-3 text-left">
      {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
      <ErrorNote message={wrong ? 'Those don’t match. Check the word numbers.' : undefined} />
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
