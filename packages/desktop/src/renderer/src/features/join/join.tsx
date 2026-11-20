import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { QrCodeScanIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { I } from '@/components/kit'
import { Creature } from '@/components/creature'
import { leave, onBack, scan } from '@/lib/native'
import { join, phone } from '@/lib/phone'
import { navigate } from '@/lib/router'

type JoinStep = 'start' | 'connecting' | 'code' | 'joined' | 'removed'

const SPOTS = [[-124, -36], [-70, -112], [0, -146], [70, -112], [124, -36]]

function Welcomed() {
  return <>
    <div className="relative mt-28 mb-2 grid size-28 place-items-center">
      <span className="absolute inset-0 scale-[2.4] rounded-full bg-[radial-gradient(circle,#f7c94840,transparent_62%)]" />
      {SPOTS.map(([x, y], index) => <span key={index} className="absolute top-5 left-1/2 -ml-7 animate-[outhut_.7s_var(--ease-spring)_both] [animation-delay:calc(.3s+var(--i)*.14s)]"
        style={{ '--sx': `${x}px`, '--sy': `${y}px`, '--i': index } as CSSProperties}>
        <span className="block animate-[hop_2.4s_ease-in-out_infinite] [animation-delay:calc(1.1s+var(--i)*.14s)]"><Creature id={`welcome-${index}`} size={56} /></span>
      </span>)}
      <Hut className="relative size-28 [&>svg]:animate-hop" />
    </div>
    <h1 className="m-0 text-[24px]/[1.25] font-semibold">You're in!</h1>
    <p className="m-0 max-w-[300px] text-[15px]/[1.5] text-body">Your agents fit in your pocket now. Talk to them from anywhere.</p>
  </>
}

export function Join({ removed, link, paired }: { removed: boolean; link: { code: string } | undefined; paired: boolean }) {
  const home: JoinStep = removed ? 'removed' : 'start'
  const [step, setStep] = useState<JoinStep>(link ? 'connecting' : home)
  const [digits, setDigits] = useState('')
  const [error, setError] = useState<string>()
  const attempt = useRef(0)
  const client = useQueryClient()
  const cancel = () => {
    attempt.current++
    setError(undefined)
    if (link) phone.forgetLink()
    if (!paired) setStep(home)
  }
  const pair = (code: string) => {
    const mine = ++attempt.current
    setError(undefined)
    setStep('connecting')
    void join({ code, onDigits: (shown) => { if (mine === attempt.current) { setDigits(shown); setStep('code') } } }).then(() => {
      if (mine === attempt.current) setStep('joined')
    }, (err: unknown) => {
      if (mine !== attempt.current) return
      setError(err instanceof Error ? err.message : String(err))
      setStep(home)
    })
  }
  const scanCode = () => void scan().then((code) => { if (code) pair(code) }, () => undefined)
  const pairing = useRef(pair)
  pairing.current = pair
  useEffect(() => {
    if (!link) return
    pairing.current(link.code)
  }, [link])
  useEffect(() => onBack(() => {
    if (step === 'connecting' || step === 'code') cancel()
    else leave()
  }))
  const enter = () => {
    client.clear()
    phone.enter()
    navigate('/', true)
  }
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <div className="h-[52px] shrink-0" />
    {step === 'connecting' && <Center>
      <Hut className="mb-2 size-16 [&>svg]:animate-[hop_1.6s_ease-in-out_infinite]" />
      <p className="m-0 text-[15px] text-body">Connecting to your Mac…</p>
    </Center>}
    {step === 'code' && <Center>
      <Hut className="mb-2 size-16 [&>svg]:animate-[hop_1.6s_ease-in-out_infinite]" />
      <p className="m-0 text-[15px] text-body">Check that your Mac shows</p>
      <span data-digits className="text-[40px]/[1] font-semibold tabular-nums tracking-[.06em]">{digits.slice(0, 3)} {digits.slice(3)}</span>
      <p className="m-0 text-[15px] text-body">then press <b className="font-semibold text-ink">Allow</b> there.</p>
    </Center>}
    {step === 'joined' && <>
      <Center><Welcomed /></Center>
      <Foot><Button variant="primary" size="lg" className="w-full justify-center" onClick={enter}>Say hello</Button></Foot>
    </>}
    {step === 'removed' && <>
      <Center>
        <Hut className="size-20 opacity-50 grayscale" />
        <h1 className="m-0 text-[22px]/[1.3] font-semibold">This phone was removed</h1>
        <p className="m-0 max-w-[300px] text-[15px]/[1.5] text-body">It was removed on your Mac, so it can't reach your agents anymore. Scan a new code to add it again.</p>
      </Center>
      {error && <ErrorNote className="mx-6 mb-4" message={error} />}
      <Foot><Button variant="primary" size="lg" className="w-full justify-center gap-2" onClick={scanCode}><I icon={QrCodeScanIcon} size={17} />Scan a code</Button></Foot>
    </>}
    {step === 'start' && <>
      <Center>
        <div className="relative"><span className="absolute inset-0 scale-150 rounded-md bg-[radial-gradient(circle,#f7c94855,transparent_65%)]" /><Hut className="relative size-28" /></div>
        <h1 className="m-0 text-[24px]/[1.25] font-semibold">Your agents, on your phone</h1>
        <p className="m-0 max-w-[300px] text-[15px]/[1.5] text-body">Open OpenHut on your Mac, go to Settings → Devices → Add a phone, and scan the code.</p>
      </Center>
      {error && <ErrorNote className="mx-6 mb-4" message={error} />}
      <Foot><Button variant="primary" size="lg" className="w-full justify-center gap-2" onClick={scanCode}><I icon={QrCodeScanIcon} size={17} />Scan the code</Button></Foot>
    </>}
  </div>
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="shrink-0 px-6 pb-10">{children}</div>
}
