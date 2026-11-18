import { useEffect, useRef, useState } from 'react'
import { Cancel01Icon, DiceFaces03Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Creature } from '@/components/creature'
import { DialogCard, I } from '@/components/kit'
import { useCreateAgent } from '@/features/agents/api'
import { FaceEditor, stageColor, tileClass } from '@/features/agents/face-editor'
import { faceUri, randomLook, type Look } from '@/lib/face'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

const LOOKS = [['Support', 'support headset'], ['Ops', 'ops beanie'], ['Sales', 'sales shades'], ['Reports', 'report glasses'], ['Finance', 'finance tophat'], ['Triage', 'triage cap']]
const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useCreateAgent()
  const [round, setRound] = useState(() => Math.floor(Math.random() * 1e6))
  const [pick, setPick] = useState(0)
  const [custom, setCustom] = useState<Look | null>(null)
  const [spin, setSpin] = useState(0)
  const [editing, setEditing] = useState(false)
  const [empty, setEmpty] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  const customize = useRef<HTMLButtonElement>(null)
  const returning = useRef(false)
  useEffect(() => {
    if (editing || !returning.current) return
    returning.current = false
    customize.current?.focus()
  }, [editing])
  const leave = () => {
    returning.current = true
    setEditing(false)
  }
  const preset = (index: number) => randomLook({ seed: `face_${round}_${index}`, about: LOOKS[index][1] })
  const look = custom ?? preset(pick)
  const choose = (patch: { round?: number; pick?: number }) => {
    setRound(patch.round ?? round)
    setPick(patch.pick ?? pick)
    setCustom(null)
    setSpin(spin + 1)
  }
  const reroll = () => {
    if (!name.current) return
    name.current.value = NAMES[(NAMES.indexOf(name.current.value) + 1) % NAMES.length]
    setEmpty(false)
  }
  return <DialogCard onClose={editing ? leave : onClose} className={cn(editing ? 'w-[min(600px,calc(100vw-32px))] gap-0 p-0' : 'w-[420px] items-center p-6 text-center')}>
    {editing && <FaceEditor initial={look} onCancel={leave} onDone={(next) => { setCustom(next); setSpin(spin + 1); leave() }} />}
    <form className={editing ? 'hidden' : 'contents'} onSubmit={(event) => createAgent.mutate({ body: { name: formValues(event)('name').trim() }, look })}>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="absolute top-3 right-3 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
      {!editing && <DialogTitle className="text-[15px]/[22px] font-medium">New agent</DialogTitle>}
      <Button type="button" variant="bare" aria-label="Other faces" title="Other faces" onClick={() => choose({ round: round + 1 })}
        className="grid size-[104px] place-items-center rounded-xl shadow-[inset_0_0_0_1px_var(--hair)]" style={{ background: stageColor(look) }}>
        <span key={spin} className={cn('block', spin > 0 && 'animate-hop')}><Creature look={look} size={84} label="Agent face" /></span>
      </Button>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Face">
        {custom && <Button type="button" variant="bare" role="radio" aria-checked aria-label="Yours" title="Yours" className={cn('size-10', tileClass(true))}><img src={faceUri({ look: custom, size: 30 })} width={30} height={30} alt="" className="block" /></Button>}
        {LOOKS.map(([label], index) => <Button key={label} type="button" variant="bare" role="radio" aria-checked={!custom && index === pick} aria-label={label} title={label} onClick={() => choose({ pick: index })}
          className={cn('size-10', tileClass(!custom && index === pick))}><img src={faceUri({ look: preset(index), size: 30 })} width={30} height={30} alt="" className="block" /></Button>)}
      </div>
      <Button ref={customize} type="button" variant="secondary" size="sm" className="rounded-full px-3" onClick={() => setEditing(true)}>Customize</Button>
      <div className="flex w-full items-center gap-2">
        <Input ref={name} name="name" autoFocus required maxLength={40} defaultValue={NAMES[0]} aria-label="Name" className="h-10 rounded-lg text-center text-base font-medium" onInput={(event) => setEmpty(!event.currentTarget.value.trim())} />
        <Button type="button" variant="secondary" size="icon" aria-label="Random name" title="Random name" className="size-10 shrink-0 rounded-lg text-ink" onClick={reroll}><I icon={DiceFaces03Icon} /></Button>
      </div>
      <Button type="submit" variant="primary" size="lg" className="h-10 w-full justify-center" disabled={empty || createAgent.isPending}>{createAgent.isPending ? 'Creating…' : 'Create'}</Button>
      {createAgent.error ? <p role="alert" className="m-0 text-xs text-fail">{createAgent.error.message}</p> : <span className="text-[12px]/[16px] text-mute">Its job, model and channels are on its right panel.</span>}
    </form>
  </DialogCard>
}
