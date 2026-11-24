import { useMemo, useState, type ReactNode } from 'react'
import { FingerPrintIcon, Key01Icon } from '@hugeicons/core-free-icons'
import { creatureName, faceName, FACES, type DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Creature } from '@/components/creature'
import { DeviceIcon } from '@/components/custom/device'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { BIG, Step } from '@/features/cloud/step'
import { faceLook } from '@/lib/face'
import { WORDS } from '@/lib/platform'
import { cn } from '@/lib/utils'

export function Named({ index, size }: { index: number; size: number }) {
  return <span className="flex flex-col items-center gap-1.5" title={faceName(index)}>
    <Creature look={faceLook(index)} size={size} label={creatureName(index)} />
    <span className={cn('font-medium text-ink', size > 80 ? '-mt-5 text-[15px]' : '-mt-2.5 text-[12.5px]')}>{creatureName(index)}</span>
  </span>
}

export function Knocking({ faces, onKit, children }: { faces: number[] | null; onKit?: () => void; children?: ReactNode }) {
  return <Step title="Knock knock." line="Your data is locked to your computers, so one of them has to let you in. Look for these two:"
    link={onKit && <Button type="button" variant="text" className="font-normal text-mute" onClick={onKit}><I icon={Key01Icon} size={14} />Use my recovery kit instead</Button>}>
    {faces ? <span className="flex gap-8">{faces.map((index) => <Named key={index} index={index} size={112} />)}</span> : <Spinner className="mt-1" />}
    <p className="m-0 max-w-[440px] text-[14px]/[20px] text-body">Open OpenHut on any of your computers. We’ll keep knocking for 15 minutes.</p>
    <p className="m-0 text-[12.5px] text-mute">Focus mode can hide the notification.</p>
    {children}
  </Step>
}

export function YoureIn({ onOpen }: { onOpen: () => void }) {
  return <Step happy title="You’re in." line={`Your ${WORDS.here === 'Mac' ? 'Mac' : 'computer'} handed this ${WORDS.here === 'Mac' ? 'Mac' : 'device'} its keys.`}
    action={<Button type="button" variant="primary" className={BIG} autoFocus onClick={onOpen}>Open OpenHut</Button>} />
}

export function pairsOf({ faces, random = Math.random }: { faces: number[]; random?: () => number }): number[][] {
  const others = Array.from({ length: FACES }, (_, i) => i).filter((each) => !faces.includes(each)).sort(() => random() - .5)
  return [faces, others.slice(0, 2), others.slice(2, 4)].sort(() => random() - .5)
}

export function flagOf(code: string): string {
  return /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((each) => 0x1f1a5 + each.charCodeAt(0))) : ''
}

export function placeOf({ location }: Pick<DeviceRequest, 'location'>): string | null {
  if (!location) return null
  return `${flagOf(location.countryCode)} near ${[location.city, location.country].filter(Boolean).join(', ')} · approximate`.trim()
}

export function kindOf(request: Pick<DeviceRequest, 'name' | 'os'>): string {
  const name = request.name ?? 'A new device'
  return request.os && request.os !== 'web' ? `${name} on ${request.os}` : name
}

export function askedAgo(at: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000))
  if (seconds < 60) return 'just now'
  return `${Math.round(seconds / 60)} min ago`
}

export function PickPair({ label, request, busy, onPick, onNotMe, onClose }: { label: string; request: DeviceRequest; busy: boolean; onPick: (faces: number[]) => void; onNotMe: () => void; onClose: () => void }) {
  const faces = request.faces
  const key = faces?.join() ?? ''
  const shown = useMemo(() => key ? pairsOf({ faces: key.split(',').map(Number) }) : [], [key])
  const [picked, setPicked] = useState<number>()
  const touch = WORDS.here === 'Mac'
  return <Dialog size="narrow" label={`Approve ${label}`} onClose={onClose}>
    <DialogHead title="Which pair is on the new screen?" subtitle={request.server ? `${label} printed them where you ran the install command.` : 'Look at the device that’s asking, then tap its faces.'} onClose={onClose} />
    <div className="grid gap-4 px-5 pt-4 pb-5">
      {faces
        ? <div className="grid grid-cols-3 gap-2.5">{shown.map((pair, index) => <Button key={pair.join()} type="button" variant="bare" aria-pressed={picked === index} disabled={busy}
            aria-label={pair.map(creatureName).join(' and ')}
            className={cn('flex justify-center gap-4 rounded-xl border-[1.5px] border-hair bg-white px-2 pt-4 pb-3', picked === index && 'border-ink ring-2 ring-ink/10')} onClick={() => setPicked(index)}>
              {pair.map((face) => <Named key={face} index={face} size={56} />)}
            </Button>)}</div>
        : <span className="inline-flex items-center gap-2 text-[13px] text-mute"><Spinner className="mt-0 size-3" />Waiting for the new device to show its faces…</span>}
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-xl border border-hair bg-card px-3.5 py-2.5 text-left text-[13px]"><DeviceIcon kind={request.server ? 'server' : 'mac'} />{kindOf(request)}
        <span className="text-mute">{['', placeOf(request), `asked ${askedAgo(request.at)}`, request.email].filter((each) => each !== null).join(' · ')}</span></span>
      {request.newCountry && <p className="m-0 -mt-2 rounded-xl bg-warning-subtle px-3.5 py-2.5 text-left text-[13px] text-warning-strong">First request from this country. Location is a hint, not proof: only let it in if this is you.</p>}
      {request.location && <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="-mt-2 text-right text-[11px] text-mute underline-offset-2 hover:underline">IP Geolocation by DB-IP</a>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="text" className="font-normal text-mute" disabled={busy} onClick={onNotMe}>None of these: not me</Button>
        <Button type="button" variant="primary" className="gap-2" disabled={busy || picked === undefined} onClick={() => picked !== undefined && onPick(shown[picked])}>
          {touch && <I icon={FingerPrintIcon} size={16} />}{busy ? 'Waiting…' : touch ? 'Touch ID to let it in' : 'Let it in'}
        </Button>
      </div>
    </div>
  </Dialog>
}
