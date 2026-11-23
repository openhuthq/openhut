import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { ComputerPhoneSyncIcon, CloudUploadIcon, Key01Icon, SourceCodeIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Cloud, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { kitText, readKit } from '@openhut/common/vault/kit-file.ts'
import { migrating } from '@/app/gate-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { CopyButton } from '@/components/copy-button'
import { DropZone } from '@/components/custom/drop-zone'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { I } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useCancelSignIn, useCloud, useNewKit, useSignIn, useSigningIn } from '@/features/cloud/api'
import { PRIMARY, Step, Window } from '@/features/cloud/step'
import { Row, Rows } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { open, usePath } from '@/lib/router'
import { copyText } from '@/lib/clipboard'

const INK = '#0b0b0b'
const POINTS = [
  [ComputerPhoneSyncIcon, 'Your agents and chats follow you to every computer you add'],
  [SquareLock02Icon, 'Encrypted on your device. No one can read it, including us'],
  [SourceCodeIcon, 'Open source, so anyone can check how it works'],
] as const
const INVITED = 'Sign in with the email your invite went to. Everything you share there stays end-to-end encrypted.'

export function SignIn({ cloud }: { cloud: Cloud | undefined }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  const cancel = useCancelSignIn()
  const online = useOnline()
  const agents = useAgents().data?.length ?? 0
  const invited = usePath() === '/join'
  const moving = migrating({ agents, invited })
  const busy = waiting || signIn.isPending
  return <Window>
    <span className="relative mb-1">
      <span className="absolute inset-0 scale-150 animate-[fadein_.7s_.3s_both] rounded-full bg-[radial-gradient(circle,#f7c94855,transparent_65%)]" />
      <Hut mood={invited ? 'party' : 'looking'} className="relative size-28 [&>svg]:animate-[hop-rest_3.6s_cubic-bezier(.2,.8,.2,1)_.6s_infinite]" />
    </span>
    <h1 className="m-0 text-[20px]/[1.3] font-semibold">{invited ? 'You’re invited to a team' : moving ? 'Sign in to keep using OpenHut' : 'Your agents, on every computer you use'}</h1>
    {(invited || moving) && <p className="m-0 max-w-[450px] text-[14px]/[1.5] text-body">{invited ? INVITED : moving}</p>}
    {!invited && <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-left">{POINTS.map(([icon, text]) => <li key={text} className="flex items-center gap-3 text-[14px]/[1.4] text-body"><I icon={icon} size={18} className="shrink-0 text-mute" />{text}</li>)}</ul>}
    {isPhone()
      ? <p className="m-0 text-[13px] text-mute">Sign in to OpenHut on your computer.</p>
      : <div className="mt-2 flex flex-col items-center gap-2.5">
        <Button type="button" variant="primary" className="h-10 w-[260px] justify-center gap-2 rounded-[10px] text-[15px]" disabled={!online || signIn.isPending} onClick={() => signIn.mutate()}>
          {busy ? <><Spinner className="mt-0 border-white/30 border-t-white" />Finish signing in your browser</> : <><Google size={16} />Continue with Google</>}
        </Button>
        {waiting
          ? <Button type="button" variant="text" className="h-[21px] text-[14px] font-normal text-mute" onClick={cancel}>Cancel</Button>
          : !invited && <Button type="button" variant="text" className="h-[21px] text-[14px]" onClick={() => open('join-link')}>I have an invite link</Button>}
      </div>}
    {online ? <ErrorNote className="max-w-[420px]" message={signIn.error?.message ?? cloud?.signInError ?? undefined} /> : <p className="m-0 text-[13px] text-mute">OpenHut needs the internet the first time.</p>}
  </Window>
}

function useOnline(): boolean {
  return useSyncExternalStore((listener) => {
    addEventListener('online', listener)
    addEventListener('offline', listener)
    return () => {
      removeEventListener('online', listener)
      removeEventListener('offline', listener)
    }
  }, () => navigator.onLine)
}

function Benefit({ icon, title }: { icon: typeof Key01Icon; title: string }) {
  return <Row icon={<I icon={icon} size={20} className={icon === Key01Icon ? 'text-hue-amber' : 'text-hue-blue'} />} title={title} />
}

export function AllSet({ onDone }: { onDone: () => void }) {
  return <Step art={<span className="relative"><Hut className="calm blink-once size-[96px]" /><svg viewBox="0 0 20 20" className="sparkle absolute -top-1 -right-3 size-5" aria-hidden><path d="M10 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="#f7c948" stroke="#0b0b0b" strokeWidth={1.6} strokeLinejoin="round" /></svg></span>}
    title="All set" line="Keep your recovery kit somewhere safe."
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onDone}>Done</Button>}>
    <div className="w-full max-w-[360px] text-left">
      <Rows>
        <Benefit icon={CloudUploadIcon} title="Backed up" />
        <Benefit icon={Key01Icon} title="Recovery kit saved" />
      </Rows>
    </div>
  </Step>
}

type KitBridge = { save: (input: { name: string; body: string }) => Promise<{ canceled?: boolean; text?: string }> }
const kitBridge: KitBridge | undefined = Reflect.get(window, 'openhut')?.kit
type KitStep = 'save' | 'paste' | 'drop' | 'words' | 'type'
const LINK = 'h-auto p-0 text-[12.5px] font-normal text-ink underline underline-offset-2'

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
  return <Step art={<Mascot kind="kit" size={96} alive />} title={old && !kit ? 'New recovery kit' : 'Save your recovery kit'} line="If you ever lose every computer you use, this kit gets you back in. We can’t reset it for you." back={onBack}
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
