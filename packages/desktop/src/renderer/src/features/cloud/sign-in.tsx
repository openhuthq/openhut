import { useState, type FormEvent } from 'react'
import { CloudIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Creature } from '@/components/creature'
import { Hut } from '@/components/hut'
import { I, PILL } from '@/components/kit'
import { useCloud, useNewKit, useSignIn } from '@/features/cloud/api'
import { HERE } from '@/features/settings/desktop'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import team from './team.png'

const INK = '#0b0b0b'
const LEARN = 'https://openhut.dev/docs/cloud'

export function CloudOff() {
  const signIn = useSignIn()
  return <div className="flex flex-col items-center gap-4 px-6 pt-4 text-center">
    <span className="flex items-end justify-center gap-2">
      <Creature id="helpdesk-1" size={56} />
      <Hut mood="key" className="mx-1 size-[84px]" />
      <Creature id="sales-2" size={56} />
    </span>
    <span className="text-[18px]/[1.3] font-semibold">Your agents, everywhere</span>
    <YouVsUs />
    <Features />
    <TurnOn pending={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })} />
  </div>
}

export function NeedsCloud({ title }: { title: string }) {
  const signIn = useSignIn()
  return <div className="flex flex-col items-center gap-3 px-2 pt-2 pb-2 text-center">
    <img src={team} alt="" width={420} height={140} className="mix-blend-multiply" />
    <span className="text-[18px]/[1.3] font-semibold">{title}</span>
    <YouVsUs team />
    <div className="mt-1 flex gap-2"><TurnOn pending={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })} /></div>
  </div>
}

export function TurnOn({ pending, onClick, short }: { pending: boolean; onClick: () => void; short?: boolean }) {
  if (isPhone()) return <span className="text-[13px] text-mute">Turn on OpenHut Cloud in OpenHut on your {HERE}.</span>
  return <Button type="button" variant={short ? 'secondary' : 'primary'} className={short ? `${PILL} gap-1.5` : 'gap-1.5'} disabled={pending} onClick={onClick}><I icon={CloudIcon} size={short ? 14 : 15} />{pending ? 'Connecting…' : short ? 'Turn on' : 'Turn on OpenHut Cloud'}</Button>
}

function YouVsUs({ team }: { team?: boolean }) {
  return <p className="m-0 inline-flex max-w-[620px] items-center justify-center gap-2 text-center text-[14px]/[21px] text-body">
    <I icon={SquareLock02Icon} size={16} className="mt-[2px] shrink-0 text-ink" />
    <span>{team ? 'We store your team\'s data, but we can\'t read it. Only your team\'s devices can.' : 'We store your data, but we can\'t read it. Only your devices can.'} <a href={LEARN} target="_blank" rel="noreferrer" className="whitespace-nowrap text-ink underline underline-offset-2">Read more</a></span>
  </p>
}

function Features() {
  const rows: ['backup' | 'sync' | 'team', string, string][] = [
    ['backup', 'Backups', 'Lose your Mac, keep everything.'],
    ['sync', 'Sync', 'Same agents on every Mac and your phone.'],
    ['team', 'Teams', 'Share agents with coworkers.'],
  ]
  return <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-hair bg-card text-left">{rows.map(([kind, title, note]) => <div key={title} className="flex items-center gap-3.5 border-b border-hair px-4 py-2.5 last:border-0">
    <Mascot kind={kind} size={34} />
    <span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">{title}</span><span className="text-[12px] text-mute">{note}</span></span>
  </div>)}</div>
}

export function SaveKit() {
  const cloud = useCloud().data
  const kit = cloud?.kit
  const saved = Boolean(kit && !kit.differs)
  const young = cloud?.youngUntil
  const make = useNewKit()
  const [shown, setShown] = useState<RecoveryKit>()
  const [replaced, setReplaced] = useState(false)
  const [checking, setChecking] = useState(false)
  const create = () => make.mutate(undefined, { onSuccess: (made) => { if (!isPhone()) download(made); setReplaced(Boolean(kit)); setShown(made) }, onError: toastError })
  if (shown && checking) return <ConfirmKit kit={shown} onBack={() => setChecking(false)} onDone={() => open()} />
  if (shown) return <KitWords kit={shown} replaced={replaced} onSaved={() => setChecking(true)} />
  return <Dialog size="narrow" label="Save a way back in" dismissable={false} onClose={() => open()}>
    <DialogHead title="Save a way back in" />
    <div className="flex flex-col gap-4 px-5 py-6 text-[13px]/[18px]">
      <p className="m-0 text-body">We can't reset your key. Save your recovery kit to get back in.</p>
      <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Mascot kind="kit" size={24} />
          <span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Recovery kit</span><span className="text-[12px] text-mute">{saved ? 'Saved. Keep it offline.' : '12 words. Keep them offline.'}</span></span>
          {!young && <Button type="button" variant="secondary" className={PILL} disabled={make.isPending} onClick={create}>{saved ? 'Make a new kit' : isPhone() ? 'Show the words' : 'Download'}</Button>}
        </div>
      </div>
      {young && <p className="m-0 text-[12px] text-mute">This {HERE} was added less than 3 days ago, so it can’t make a kit yet. Make one from an older device, or wait until {shortDate.format(new Date(young))}.</p>}
    </div>
    <DialogFoot start={<span className="text-[12px] text-mute">{(saved || !young) && (saved ? 'You can get back in on a new Mac.' : 'Save it to continue.')}</span>}><Button type="button" variant="primary" disabled={!saved && !young} onClick={() => open()}>Continue</Button></DialogFoot>
  </Dialog>
}

function numbered(kit: RecoveryKit): string {
  return kit.words.map((word, index) => `${index + 1}. ${word}`).join('\n')
}

function download(kit: RecoveryKit) {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([`OpenHut recovery kit\n\nThese 12 words and your Google account open your cloud. Keep them offline.\n\n${numbered(kit)}\n`], { type: 'text/plain' })), download: 'openhut-recovery-kit.txt' })
  link.click()
  URL.revokeObjectURL(link.href)
}

function KitWords({ kit, replaced, onSaved }: { kit: RecoveryKit; replaced: boolean; onSaved: () => void }) {
  return <Dialog size="narrow" label="Save your recovery words" onClose={() => open()}>
    <DialogHead title="Save your recovery words" onClose={() => open()} />
    <div className="flex flex-col gap-4 px-5 py-6 text-[13px]/[18px]">
      <p className="m-0 text-body">They unlock your cloud on a new Mac. We can't reset them.</p>
      {replaced && <p className="m-0 font-medium text-ink">Your old recovery words stop working now.</p>}
      <div className="grid grid-cols-3 gap-2 phone:grid-cols-2">{kit.words.map((word, index) => <span key={index} className="flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 font-mono text-[13px]"><span className="w-4 text-right text-[11px] text-mute">{index + 1}</span>{word}</span>)}</div>
    </div>
    <DialogFoot start={<CopyButton text={numbered(kit)} label="Copy" />}><Button type="button" variant="primary" onClick={onSaved}>I saved them</Button></DialogFoot>
  </Dialog>
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
  return <Dialog size="narrow" label="Check your recovery words" dismissable={false} onClose={() => open()}>
    <form onSubmit={submit}>
      <DialogHead title="Check your recovery words" />
      <div className="flex flex-col gap-4 px-5 py-6 text-[13px]/[18px]">
        <p className="m-0 text-body">Type two of them, so we know the kit is saved.</p>
        {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
        <ErrorNote message={wrong ? 'Those words don’t match your kit. Check the numbers and try again.' : undefined} />
      </div>
      <DialogFoot start={<Button type="button" variant="secondary" onClick={onBack}>Back</Button>}><Button type="submit" variant="primary">Done</Button></DialogFoot>
    </form>
  </Dialog>
}

function Smile({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx={-11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <ellipse cx={11} cy={5} rx={3.6} ry={2.2} fill="#EDB5AE" />
    <circle cx={-6} cy={0} r={2.6} fill={INK} />
    <circle cx={6} cy={0} r={2.6} fill={INK} />
    <path d="M-4 5q4 4 8 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
  </g>
}

export function Mascot({ kind, size }: { kind: 'phone' | 'kit' | 'backup' | 'sync' | 'team'; size: number }) {
  const line = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const }
  return <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" aria-hidden>
    {kind === 'phone' && <><rect x={28} y={10} width={44} height={80} rx={11} fill="#19B3B1" {...line} /><rect x={35} y={20} width={30} height={54} rx={5} fill="#fbe3c8" /><Smile x={50} y={45} /><circle cx={50} cy={82} r={2.5} fill={INK} /></>}
    {kind === 'kit' && <><rect x={18} y={20} width={50} height={62} rx={7} fill="#fbe3c8" {...line} /><Smile x={43} y={42} /><path d="M30 62h26M30 70h18" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={0.35} /><circle cx={74} cy={38} r={10} fill="#f7c948" {...line} /><path d="M74 48v28m0-8h7m-7-8h6" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" /></>}
    {kind === 'backup' && <><path d="M28 74h46a16 16 0 0 0 0-32a22 22 0 0 0-42-4a18 18 0 0 0-4 36z" fill="#fff" {...line} /><Smile x={51} y={56} /></>}
    {kind === 'sync' && <><rect x={12} y={26} width={54} height={38} rx={6} fill="#3d8fdc" {...line} /><rect x={18} y={32} width={42} height={26} rx={3} fill="#fbe3c8" /><Smile x={39} y={45} s={0.8} /><path d="M6 72h66" {...line} strokeLinecap="round" /><rect x={66} y={40} width={24} height={42} rx={6} fill="#19B3B1" {...line} /><Smile x={78} y={60} s={0.55} /></>}
    {kind === 'team' && <><circle cx={26} cy={58} r={17} fill="#ff7a59" {...line} /><Smile x={26} y={58} s={0.7} /><circle cx={74} cy={58} r={17} fill="#19B3B1" {...line} /><Smile x={74} y={58} s={0.7} /><circle cx={50} cy={50} r={20} fill="#f7c948" {...line} /><Smile x={50} y={50} s={0.8} /></>}
  </svg>
}
