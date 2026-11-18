import { useRef, useState, type ReactNode } from 'react'
import { ArrowRight01Icon, Cancel01Icon, DiceFaces03Icon } from '@hugeicons/core-free-icons'
import type { Provider } from '@openhut/common/models/provider.ts'
import type { HelperModels } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Creature } from '@/components/creature'
import { DialogCard, I } from '@/components/kit'
import { useCreateAgent } from '@/features/agents/api'
import { useComputerProviders } from '@/features/models/api'
import { HelperRows } from '@/features/models/helper-rows'
import { automatic } from '@/features/models/labels'
import { ModelPicker } from '@/features/models/model-picker'
import { formValues } from '@/lib/form'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
import { cn } from '@/lib/utils'

const LOOKS = ['support headset', 'ops beanie', 'sales shades', 'report glasses', 'finance tophat', 'triage cap']
const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

const DEFAULT_MODEL = 'claude:sonnet'
const NO_HELPERS: HelperModels = { compress: null, title: null, review: null }

function firstModel(providers: Provider[] | undefined): string | null {
  const ready = providers?.filter((provider) => provider.connected) ?? []
  if (ready.some((provider) => provider.id === 'claude' && provider.models.some((model) => model.id === 'sonnet' && model.on))) return DEFAULT_MODEL
  const found = ready.flatMap((provider) => provider.models.filter((model) => model.on).map((model) => `${provider.id}:${model.id}`))
  return found[0] ?? null
}

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useCreateAgent()
  const providers = useComputerProviders('local')
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [fallback, setFallback] = useState<string | null>(null)
  const [helpers, setHelpers] = useState<HelperModels>(NO_HELPERS)
  const [typed, setTyped] = useState(NAMES[0])
  const model = picked === undefined ? firstModel(providers) : picked
  const [round, setRound] = useState(() => Math.floor(Math.random() * 1e6))
  const [pick, setPick] = useState(0)
  const [empty, setEmpty] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  const look = (index: number) => ({ id: `face_${round}_${index}`, about: LOOKS[index] })
  const reroll = () => {
    if (!name.current) return
    name.current.value = NAMES[(NAMES.indexOf(name.current.value) + 1) % NAMES.length]
    setTyped(name.current.value)
    setEmpty(false)
  }
  return <DialogCard onClose={onClose} className="max-h-[calc(100vh-32px)] w-[480px] items-center p-6 text-center [&_form>*]:shrink-0">
    <form className="contents" onSubmit={(event) => createAgent.mutate({ body: { name: formValues(event)('name').trim(), ...(model && { model }), ...(fallback && { fallbackModel: fallback }), helperModels: helpers }, look: look(pick) })}>
      <DialogTitle className="text-[15px]/[22px] font-medium">New agent</DialogTitle>
      <Button type="button" variant="bare" aria-label="Other faces" title="Other faces" onClick={() => setRound(round + 1)}
        className="grid size-[104px] place-items-center rounded-xl bg-[radial-gradient(circle_at_50%_40%,#fff6d8,#f3ecdf)] shadow-[inset_0_0_0_1px_var(--hair)]"><Creature id={look(pick).id} about={look(pick).about} size={84} /></Button>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Face">{LOOKS.map((about, index) => <Button key={about} type="button" variant="bare" role="radio" aria-checked={index === pick} aria-label={about} onClick={() => setPick(index)}
        className={cn('grid size-10 place-items-center rounded-lg', index === pick ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-sidebar hover:bg-mid')}><Creature id={look(index).id} about={about} size={30} /></Button>)}</div>
      <div className="flex w-full items-center gap-2">
        <Input ref={name} name="name" autoFocus required maxLength={40} defaultValue={NAMES[0]} aria-label="Name" className="h-10 rounded-lg text-center text-base font-medium" onInput={(event) => { setTyped(event.currentTarget.value); setEmpty(!event.currentTarget.value.trim()) }} />
        <Button type="button" size="icon" aria-label="Random name" title="Random name" onClick={reroll}><I icon={DiceFaces03Icon} /></Button>
      </div>
      <div className="flex w-full flex-col gap-2.5 text-left">
        <Setting title="Model" hint="What it thinks with.">
          <ModelPicker providers={providers} value={model} onPick={(key) => { setPicked(key); if (key === fallback) setFallback(null) }} label="Model" title={`${typed.trim() || 'The agent'} thinks with`} className={cn(SOFT_TRIGGER, 'w-[200px]')} />
        </Setting>
        <Setting title="Fallback" hint="Takes over if the model is rate-limited or down.">
          <ModelPicker providers={providers} value={fallback} exclude={model} onPick={setFallback} label="Fallback model" title={`If ${typed.trim() || 'the agent'} can’t answer, it tries`} className={cn(SOFT_TRIGGER, 'w-[200px]')}
            none={{ name: 'No fallback', note: 'It stops answering until the model is back', icon: <I icon={Cancel01Icon} size={14} /> }} />
        </Setting>
      </div>
      <Collapsible className="flex w-full flex-col items-start gap-2.5">
        <CollapsibleTrigger render={<Button type="button" variant="bare" className="group -ml-0.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-mute hover:bg-hover hover:text-ink" />}><I icon={ArrowRight01Icon} size={14} className="transition-[rotate] group-data-panel-open:rotate-90" />Advanced</CollapsibleTrigger>
        <CollapsibleContent className="flex w-full flex-col gap-2.5 rounded-lg bg-sidebar p-3 text-left">
          <div className="grid gap-0.5"><b className="text-[13px] font-medium">Helper models</b><p className="m-0 text-[12px]/[16px] text-mute">Small jobs it does in the background. Automatic picks a fast model from the same provider as its main one, so {typed.trim() || 'it'} would use {model ? automatic({ providers, key: model }).name : 'the main model'}.</p></div>
          <HelperRows providers={providers} main={model ?? DEFAULT_MODEL} values={helpers} who={typed.trim() || 'The agent'} onPick={(slot, key) => setHelpers({ ...helpers, [slot]: key })} />
        </CollapsibleContent>
      </Collapsible>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={empty || createAgent.isPending}>{createAgent.isPending ? 'Creating…' : 'Create'}</Button>
      {createAgent.error ? <p role="alert" className="m-0 text-xs text-fail">{createAgent.error.message}</p> : <span className="text-[12px] text-mute">Its job, model and channels are on its right panel.</span>}
    </form>
  </DialogCard>
}

function Setting({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <span className="grid min-w-0 flex-1 basis-[180px]"><span className="text-[13px]/[18px] font-medium">{title}</span><span className="text-[12px]/[16px] text-mute">{hint}</span></span>
    {children}
  </div>
}
