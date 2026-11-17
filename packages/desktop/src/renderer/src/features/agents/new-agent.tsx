import { useRef, useState } from 'react'
import { DiceFaces03Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Creature } from '@/components/creature'
import { DialogCard, I } from '@/components/kit'
import { useCreateAgent } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

const LOOKS = ['support headset', 'ops beanie', 'sales shades', 'report glasses', 'finance tophat', 'triage cap']
const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useCreateAgent()
  const [round, setRound] = useState(() => Math.floor(Math.random() * 1e6))
  const [pick, setPick] = useState(0)
  const [empty, setEmpty] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  const look = (index: number) => ({ id: `face_${round}_${index}`, about: LOOKS[index] })
  const reroll = () => {
    if (!name.current) return
    name.current.value = NAMES[(NAMES.indexOf(name.current.value) + 1) % NAMES.length]
    setEmpty(false)
  }
  return <DialogCard onClose={onClose} className="w-[420px] items-center p-6 text-center">
    <form className="contents" onSubmit={(event) => createAgent.mutate({ body: { name: formValues(event)('name').trim() }, look: look(pick) })}>
      <DialogTitle className="font-display text-[30px]/none font-normal uppercase">New agent</DialogTitle>
      <Button type="button" variant="bare" aria-label="Other faces" title="Other faces" onClick={() => setRound(round + 1)}
        className="grid size-[104px] place-items-center rounded-xl bg-[radial-gradient(circle_at_50%_40%,#fff6d8,#f3ecdf)] shadow-[inset_0_0_0_1px_var(--hair)]"><Creature id={look(pick).id} about={look(pick).about} size={84} /></Button>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Face">{LOOKS.map((about, index) => <Button key={about} type="button" variant="bare" role="radio" aria-checked={index === pick} aria-label={about} onClick={() => setPick(index)}
        className={cn('grid size-10 place-items-center rounded-lg', index === pick ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-sidebar hover:bg-mid')}><Creature id={look(index).id} about={about} size={30} /></Button>)}</div>
      <div className="flex w-full items-center gap-2">
        <Input ref={name} name="name" autoFocus required maxLength={40} defaultValue={NAMES[0]} aria-label="Name" className="h-10 rounded-lg text-center text-base font-medium" onInput={(event) => setEmpty(!event.currentTarget.value.trim())} />
        <Button type="button" size="icon" aria-label="Random name" title="Random name" onClick={reroll}><I icon={DiceFaces03Icon} /></Button>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={empty || createAgent.isPending}>{createAgent.isPending ? 'Creating…' : 'Create'}</Button>
      {createAgent.error ? <p role="alert" className="m-0 text-xs text-fail">{createAgent.error.message}</p> : <span className="font-copy text-xs text-mute-2">Its job, model and channels are on its right panel.</span>}
    </form>
  </DialogCard>
}
