import { useEffect, useState, type ReactNode } from 'react'
import { Cancel01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { PROVIDERS, providerInfo, type ProviderId } from '@openhut/common/models/provider.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Row as SettingsRow, Rows } from '@/features/settings/kit'
import { useIsAdmin } from '@/features/people/api'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { Choice, DialogCard, I, MenuCard, PILL } from '@/components/kit'
import { Glyph } from '@/components/glyph'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { useStartSeatSignIn } from '@/features/settings/api'
import { ModelsStep, SeatSignIn, stepOf } from '@/features/settings/models'
import { DEFAULT_MODEL, firstModel, runsOnChoices } from '@/features/agents/form'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DEVICE_HUE, DEVICE_ICONS } from '@/components/custom/device'
import { nameOf, useComputers } from '@/features/computers/api'
import { noteOf } from '@/features/settings/computers'
import { HERE, type Computer } from '@/lib/openhut'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker, SOFT_TRIGGER } from '@/features/models/model-picker'
import { FacePicker } from '@/features/agents/face-picker'
import { formValues } from '@/lib/form'
import { TOUCH, useMedia } from '@/lib/media'
import { open, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

const PICKER = cn(SOFT_TRIGGER, 'w-[270px] min-w-0 max-w-full gap-2 phone:w-auto phone:flex-1')

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  return <DialogCard onClose={onClose} className="max-h-[calc(100vh-32px)] w-[480px] p-6">
    <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="absolute top-3 right-3 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    <DialogTitle className="text-[15px]/[22px] font-medium">New agent</DialogTitle>
    <AgentForm />
  </DialogCard>
}

export function FirstAgent() {
  return <div className="flex min-h-0 w-full flex-1 flex-col text-center text-ink">
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-6">
      <div className="flex w-[360px] max-w-full flex-col items-center">
        <h1 className="m-0 text-[30px]/[36px] font-bold tracking-[-.03em] text-balance phone:text-[28px]/[34px]">Make your first agent.</h1>
        <p className="m-0 mt-2 max-w-[320px] text-[15px]/[22px] text-balance text-body">Give it a job in your first chat.</p>
        <div className="mt-8 flex w-full flex-col items-center gap-3 text-[13px]/[18px]"><AgentForm /></div>
      </div>
    </div>
  </div>
}

function AgentForm() {
  const createAgent = useCreateAgent()
  const touch = useMedia(TOUCH)
  const providers = useComputerProviders('local')
  const [picked, setPicked] = useState<string | null>(null)
  const [runsOn, setRunsOn] = useState(HERE)
  const computers = runsOnChoices(useComputers().data)
  const [wanted, setWanted] = useState<ProviderId>()
  const seat = useStartSeatSignIn()
  const [signing, setSigning] = useState<{ name: string; face: string } | 'only'>()
  const setup = stepOf(useOpen())
  const taken = new Set(useAgents().data?.map((agent) => agent.name))
  const name = NAMES.find((each) => !taken.has(each)) ?? NAMES[0]
  const model = picked ?? firstModel(providers) ?? DEFAULT_MODEL
  const none = Boolean(providers && !providers.some((provider) => provider.connected))
  const unready = Boolean(providers && !providers.some((provider) => provider.connected && model.startsWith(`${provider.id}:`)))
  const { mutate: prepare, isIdle } = seat
  useEffect(() => { if (unready && isIdle) prepare() }, [unready, isIdle, prepare])
  const added = wanted && providers?.find((provider) => provider.id === wanted)?.connected
  useEffect(() => {
    if (!added || !wanted) return
    setPicked(firstModel(providers, wanted))
    setWanted(undefined)
    if (setup) open()
  }, [added, wanted, providers, setup])
  const setUp = (id: ProviderId) => {
    setWanted(id)
    if (id === 'claude') setSigning('only')
    else open(id)
  }
  const create = ({ name, face }: { name: string; face: string }) => createAgent.mutate({ name, face, model, runsOn })
  return <form className="flex w-full flex-col items-center gap-4" onSubmit={(event) => {
    if (event.target !== event.currentTarget) return
    const field = formValues(event)
    const typed = { name: field('name').trim() || name, face: field('face') }
    if (unready && model.startsWith('claude:')) return setSigning(typed)
    create(typed)
  }}>
    {signing && <SeatSignIn start={seat} onClose={() => setSigning(undefined)} onDone={() => { if (signing !== 'only') create(signing); setSigning(undefined) }} />}
    {setup && setup !== 'claude' && <ModelsStep id={setup} />}
    <FacePicker initial={null} compact />
    <Input name="name" required maxLength={40} defaultValue={name} placeholder={name} aria-label="Name" autoFocus={!touch} autoComplete="off" spellCheck={false} enterKeyHint="go"
      className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-center text-[22px]/[1.3] font-semibold shadow-none focus-visible:ring-0 text-ink outline-none placeholder:text-mute-2" />
    <div className="flex w-full flex-col divide-y divide-hair border-y border-hair text-left">
      {computers.length > 0 && <Row title="Runs on"><ComputerPicker computers={computers} value={runsOn} onPick={setRunsOn} /></Row>}
      {none && <ConnectModel onSetUp={setUp} />}
      {!none && <Row title="Model">
        <ModelPicker providers={providers} value={model} onPick={setPicked} onSetUp={setUp} label="Model" title="It thinks with" className={PICKER}>
          {unready ? <NeedsSignIn model={model} /> : undefined}
        </ModelPicker>
      </Row>}
    </div>
    <Button type="submit" variant="primary" className="h-10 w-full justify-center rounded-[10px] text-[15px]" disabled={createAgent.isPending || !providers || none}>{createAgent.isPending ? 'Creating…' : 'Create agent'}</Button>
    <ErrorNote message={createAgent.error?.message} />
  </form>
}

function ComputerPicker({ computers, value, onPick }: { computers: Computer[]; value: string; onPick: (id: string) => void }) {
  const name = nameOf({ computers, id: value })
  return <DropdownMenu>
    <DropdownMenuTrigger className={PICKER} aria-label={`Runs on: ${name}`}>
      <I icon={DEVICE_ICONS.server} size={14} className="shrink-0 text-mute" />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <MenuCard title="It runs on">
      {computers.map((computer) => <Choice key={computer.id} icon={<I icon={DEVICE_ICONS.server} size={15} className={DEVICE_HUE} />} name={computer.name} note={noteOf(computer)} selected={computer.id === value} onClick={() => onPick(computer.id)} />)}
    </MenuCard>
  </DropdownMenu>
}

const KEY_PROVIDERS = PROVIDERS.filter((info) => info.kind === 'key')

function ConnectModel({ onSetUp }: { onSetUp: (id: ProviderId) => void }) {
  const admin = useIsAdmin()
  return <div className="flex flex-col gap-2 py-3">
    <div className="grid gap-0.5"><span className="text-[13px] font-medium">Connect a model first</span><span className="text-[12px]/[16px] text-mute">{admin ? 'Your agents think with it. You pick the model for each agent.' : 'Ask the owner or an admin to connect one under Settings › Models.'}</span></div>
    {admin && <Rows>
      <SettingsRow icon={<Glyph name="claude" size={20} />} title="Claude subscription" note="Pro or Max. One for this whole install." onClick={() => onSetUp('claude')}><span className={cn(buttonVariants({ variant: 'primary' }), PILL)}>Sign in</span></SettingsRow>
      {KEY_PROVIDERS.map((info) => <SettingsRow key={info.id} icon={<Glyph name={info.id} size={20} />} title={info.id === 'compatible' ? info.name : `${info.short} API key`} note={info.keysAt ? `From ${info.keysAt}` : info.blurb} onClick={() => onSetUp(info.id)}><span className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Paste key</span></SettingsRow>)}
    </Rows>}
  </div>
}

function NeedsSignIn({ model }: { model: string }) {
  const provider = model.split(':')[0] as ProviderId
  return <>
    <span className="grid w-3.5 shrink-0 place-items-center"><Glyph name={provider} size={14} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{providerInfo(provider).short} <span className="text-mute">· Sign in needed</span></span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex min-h-12 items-center justify-between gap-3 py-2">
    <span className="w-[72px] shrink-0 text-[13px] font-medium whitespace-nowrap">{title}</span>
    {children}
  </div>
}
