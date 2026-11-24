import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cancel01Icon, DiceFaces03Icon, ShuffleIcon } from '@hugeicons/core-free-icons'
import type { Provider } from '@openhut/common/models/provider.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I } from '@/components/kit'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { useComputers, whereNote } from '@/features/computers/api'
import { useStartSeatSignIn } from '@/features/settings/api'
import { SeatSignIn } from '@/features/settings/models'
import { WORDS } from '@/lib/platform'
import { ComputerPicker } from '@/features/computers/computer-picker'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker } from '@/features/models/model-picker'
import { FacePicker } from '@/features/agents/face-picker'
import { Face } from '@/features/agents/face'
import { randomLook, SWATCHES } from '@/lib/face'
import { formValues } from '@/lib/form'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
import { TOUCH, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

const DEFAULT_MODEL = 'claude:sonnet'

function firstModel(providers: Provider[] | undefined): string | null {
  const ready = providers?.filter((provider) => provider.connected) ?? []
  if (ready.some((provider) => provider.id === 'claude' && provider.models.some((model) => model.id === 'sonnet' && model.on))) return DEFAULT_MODEL
  const found = ready.flatMap((provider) => provider.models.filter((model) => model.on).map((model) => `${provider.id}:${model.id}`))
  return found[0] ?? null
}

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useCreateAgent()
  const { active } = useWorkspaces()
  const touch = useMedia(TOUCH)
  const computers = useComputers().data ?? []
  const [computer, setComputer] = useState('local')
  const providers = useComputerProviders(computer)
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const taken = new Set(useAgents().data?.map((agent) => agent.name))
  const fresh = NAMES.filter((each) => !taken.has(each))
  const names = fresh.length ? fresh : NAMES
  const [typed, setTyped] = useState(names[0])
  const [first] = useState(names[0])
  const model = picked === undefined ? firstModel(providers) : picked
  const name = useRef<HTMLInputElement>(null)
  const [empty, setEmpty] = useState(false)
  const reroll = () => {
    if (!name.current) return
    name.current.value = names[(names.indexOf(name.current.value) + 1) % names.length]
    setTyped(name.current.value)
    setEmpty(false)
  }
  return <DialogCard onClose={onClose} className="max-h-[calc(100vh-32px)] w-[480px] items-center p-6 text-center [&_form>*]:shrink-0">
    <form className="contents" onSubmit={(event) => {
      const field = formValues(event)
      createAgent.mutate({ body: { name: field('name').trim(), face: field('face'), ...(model && { model }), ...(!active.home && { workspace: active.id }) }, computer })
    }}>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="absolute top-3 right-3 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
      <DialogTitle className="text-[15px]/[22px] font-medium">New agent</DialogTitle>
      <FacePicker initial={null} />
      <div className="flex w-full items-center gap-2">
        <Input ref={name} name="name" autoFocus={!touch} autoComplete="off" enterKeyHint="go" required maxLength={40} defaultValue={first} aria-label="Name" className="h-10 rounded-lg text-center text-base font-medium" onInput={(event) => { setTyped(event.currentTarget.value); setEmpty(!event.currentTarget.value.trim()) }} />
        <Button type="button" variant="secondary" size="icon" aria-label="Random name" title="Random name" className="size-10 shrink-0 rounded-lg text-ink" onClick={reroll}><I icon={DiceFaces03Icon} /></Button>
      </div>
      <div className="flex w-full flex-col gap-2.5 text-left">
        {computers.length > 1 && <Setting title="Where should it run?" hint={whereNote(computers.find((each) => each.id === computer) ?? computers[0])}>
          <ComputerPicker computers={computers} value={computer} onPick={(id) => { setComputer(id); setPicked(undefined) }} title={`${typed.trim() || 'The agent'} runs on`} className="w-[200px]" />
        </Setting>}
        <Setting title="Model" hint="What it thinks with.">
          <ModelPicker providers={providers} value={model} onPick={setPicked} label="Model" title={`${typed.trim() || 'The agent'} thinks with`} className={cn(SOFT_TRIGGER, 'w-[200px]')} />
        </Setting>
      </div>
      <Button type="submit" variant="primary" size="lg" className="h-10 w-full justify-center" disabled={empty || createAgent.isPending}>{createAgent.isPending ? 'Creating…' : 'Create'}</Button>
      {createAgent.error ? <p role="alert" className="m-0 text-xs text-fail">{createAgent.error.message}</p> : <span className="text-[12px]/[16px] text-mute phone:hidden">You can set its job and where to talk to it next.</span>}
    </form>
  </DialogCard>
}

const COLOURS = ['rose', 'orange', 'green', 'blue', 'lilac', 'teal'].map((id) => SWATCHES.findIndex((each) => each.id === id))

export function FirstAgent() {
  const createAgent = useCreateAgent()
  const { active } = useWorkspaces()
  const providers = useComputerProviders('local')
  const computers = useComputers().data ?? []
  const [computer, setComputer] = useState('local')
  const [round, setRound] = useState(() => Math.floor(Math.random() * 1e6))
  const [colour, setColour] = useState(0)
  const [spun, setSpun] = useState(0)
  const faceOf = (index: number) => JSON.stringify({ ...randomLook({ seed: `face_${round}` }), body: COLOURS[index] })
  const face = faceOf(colour)
  const noModel = Boolean(providers && !firstModel(providers))
  const seat = useStartSeatSignIn()
  const [waiting, setWaiting] = useState<{ name: string; face: string }>()
  const here = computer === 'local'
  const sealed = computers.some((each) => each.kind === 'server') ? 'Pick your Linux server above to seal it in its own box instead.' : 'Want it sealed in its own box instead? Add a Linux server later in Settings › Computers.'
  const { mutate: prepare, isIdle } = seat
  useEffect(() => { if (noModel && isIdle) prepare() }, [noModel, isIdle, prepare])
  const create = ({ name, face, model }: { name: string; face: string; model: string | null }) => createAgent.mutate({ body: { name, face, ...(model && { model }), ...(!active.home && { workspace: active.id }) }, computer })
  return <form className="flex flex-col items-center gap-4 text-center" onSubmit={(event) => {
    const field = formValues(event)
    const picked = { name: field('name').trim(), face: field('face') }
    if (noModel) return setWaiting(picked)
    create({ ...picked, model: firstModel(providers) })
  }}>
    {waiting && <SeatSignIn start={seat} onClose={() => setWaiting(undefined)} onDone={() => { create({ ...waiting, model: DEFAULT_MODEL }); setWaiting(undefined) }} />}
    <Input type="hidden" name="face" value={face} />
    <Button type="button" variant="bare" aria-label="Shuffle" title="Shuffle" className="relative mb-1 animate-[pop_.6s_var(--ease-spring)_both]" onClick={() => { setRound(round + 1); setSpun(spun + 1) }}>
      <span className="block animate-[bob_3.2s_ease-in-out_.8s_infinite]"><span key={spun} className={cn('block', spun > 0 && 'animate-hop')}><Face agent={{ id: '', instructions: '', face }} size={150} label="Agent face" /></span></span>
      <span className="absolute right-1 bottom-3 grid size-8 place-items-center rounded-full border border-hair bg-card text-ink shadow-menu"><I icon={ShuffleIcon} size={15} /></span>
    </Button>
    <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">Make your first agent</h1>
    <p className="m-0 -mt-2 text-[14px]/[1.5] text-body">Give it a name and a face. You can tell it its job in your first chat.</p>
    <Field label={<span className="text-[12px] font-medium text-mute">Name</span>} className="mt-1 w-[352px] max-w-full text-left">{(control) => <Input {...control} name="name" required maxLength={40} defaultValue={NAMES[0]} autoComplete="off" spellCheck={false} className="h-10 rounded-lg text-[15px] font-medium" />}</Field>
    <div role="radiogroup" aria-label="Colour" className="flex gap-2">
      {COLOURS.map((swatch, index) => <Button key={swatch} type="button" variant="bare" role="radio" aria-checked={index === colour} aria-label={SWATCHES[swatch].name} title={SWATCHES[swatch].name} onClick={() => setColour(index)}
        className={cn('grid size-[52px] place-items-center rounded-xl', index === colour ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-sidebar hover:bg-picked')}><Face agent={{ id: '', instructions: '', face: faceOf(index) }} size={40} /></Button>)}
    </div>
    {computers.length > 1 && <div className="flex w-[352px] max-w-full flex-col gap-1.5 text-left">
      <span className="text-[12px] font-medium text-mute">Where should it run?</span>
      <ComputerPicker computers={computers} value={computer} onPick={setComputer} title="It runs on" className="h-10 w-full rounded-lg" />
      <span className="text-[12px]/[16px] text-mute">{whereNote(computers.find((each) => each.id === computer) ?? computers[0])}</span>
    </div>}
    {here && <p className="m-0 w-[352px] max-w-full text-left text-[12px]/[16px] text-mute">It runs on this {WORDS.here} as you, so it can open your files and run code. {sealed}</p>}
    <Button type="submit" variant="primary" className="mt-2 h-10 w-[352px] max-w-full justify-center rounded-[10px] text-[15px]" disabled={createAgent.isPending || !providers}>{createAgent.isPending ? 'Creating…' : noModel ? 'Connect Claude and create' : 'Create agent'}</Button>
    {noModel && <Button type="button" variant="text" className="-mt-2 font-normal text-mute" onClick={() => navigate('/settings/models')}>Use ChatGPT or an API key instead</Button>}
    <ErrorNote message={createAgent.error?.message} />
  </form>
}

function Setting({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <span className="grid min-w-0 flex-1 basis-[180px]"><span className="text-[13px]/[18px] font-medium">{title}</span><span className="text-[12px]/[16px] text-mute">{hint}</span></span>
    {children}
  </div>
}
