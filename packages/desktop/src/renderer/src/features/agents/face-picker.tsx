import { useRef, useState } from 'react'
import { Upload04Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { I } from '@/components/kit'
import { Face, photoOf } from '@/features/agents/face'
import { bgColor, parseLook, randomLook } from '@/lib/face'
import { squarePicture } from '@/lib/picture'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const LOOKS = [['Support', 'support headset'], ['Ops', 'ops beanie'], ['Sales', 'sales shades'], ['Reports', 'report glasses'], ['Finance', 'finance tophat'], ['Triage', 'triage cap']]

const tileClass = (on: boolean) => cn('grid size-10 place-items-center rounded-lg', on ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-sidebar hover:bg-picked')

function stageOf(face: string) {
  if (photoOf(face)) return 'var(--sidebar)'
  try {
    return bgColor(parseLook(JSON.parse(face))?.bg ?? null) ?? 'var(--sidebar)'
  } catch {
    return 'var(--sidebar)'
  }
}

const shown = (face: string) => ({ id: '', instructions: '', face })

export function FacePicker({ initial }: { initial: string | null }) {
  const [round, setRound] = useState(() => Math.floor(Math.random() * 1e6))
  const [mine, setMine] = useState(initial)
  const [pick, setPick] = useState<number | null>(initial ? null : 0)
  const [spin, setSpin] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const preset = (index: number) => JSON.stringify(randomLook({ seed: `face_${round}_${index}`, about: LOOKS[index][1] }))
  const face = pick === null && mine ? mine : preset(pick ?? 0)
  const show = ({ next = round, index, own = mine }: { next?: number; index: number | null; own?: string | null }) => {
    setRound(next)
    setPick(index)
    setMine(own)
    setSpin(spin + 1)
  }
  const shuffle = () => show({ next: round + 1, index: pick ?? 0 })
  const kept = photoOf(initial) ? null : initial
  const upload = (picked: File | undefined) => {
    if (!picked) return
    squarePicture({ source: picked, size: 256, type: 'image/jpeg' })
      .then((photo) => show({ index: null, own: photo }), () => toastError(new Error('That file is not a picture OpenHut can read.')))
  }
  return <>
    <Input type="hidden" name="face" value={face} />
    <Button type="button" variant="bare" aria-label="Other faces" title="Other faces" onClick={shuffle}
      className="grid size-[104px] place-items-center rounded-xl shadow-[inset_0_0_0_1px_var(--hair)]" style={{ background: stageOf(face) }}>
      <span key={spin} className={cn('block', spin > 0 && 'animate-hop')}><Face agent={shown(face)} size={84} label="Agent face" /></span>
    </Button>
    <div className="flex flex-wrap justify-center gap-1.5" role="radiogroup" aria-label="Face">
      {mine && <Button type="button" variant="bare" role="radio" aria-checked={pick === null} aria-label={photoOf(mine) ? 'Your picture' : 'Current face'} title={photoOf(mine) ? 'Your picture' : 'Current face'} className={tileClass(pick === null)} onClick={() => show({ index: null })}><Face agent={shown(mine)} size={30} /></Button>}
      {LOOKS.map(([label], index) => <Button key={label} type="button" variant="bare" role="radio" aria-checked={index === pick} aria-label={label} title={label} onClick={() => show({ index })}
        className={tileClass(index === pick)}><Face agent={shown(preset(index))} size={30} /></Button>)}
      <Button type="button" variant="bare" aria-label="Upload a picture" title="Upload a picture" className="grid size-10 place-items-center rounded-lg border-[1.5px] border-dashed border-mute-2 text-body hover:bg-picked" onClick={() => file.current?.click()}><I icon={Upload04Icon} size={17} /></Button>
      <Input ref={file} type="file" accept="image/*" hidden onChange={(event) => { upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
    </div>
    {pick === null && photoOf(mine)
      ? <Button type="button" variant="secondary" size="sm" className="rounded-full px-3" onClick={() => show({ index: kept ? null : 0, own: kept })}>Remove picture</Button>
      : <Button type="button" variant="secondary" size="sm" className="rounded-full px-3" onClick={shuffle}>Shuffle</Button>}
  </>
}
