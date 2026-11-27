import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Cancel01Icon, PlusSignIcon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { ProviderId } from '@openhut/common/models/provider.ts'
import { Button } from '@/components/ui/button'
import { useIsAdmin, useMe } from '@/lib/queries/people'
import { PersonFace } from '@/components/custom/person-face'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, FIELD_MENU, SOFT_TRIGGER } from '@/components/kit'
import { useCreateAgent } from '@/features/agents/api'
import { useAgents } from '@/lib/queries/agents'
import { runsOnChoices } from '@/features/agents/form'
import { firstModel, stepOf } from '@/lib/models'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DEVICE_ICONS } from '@/components/custom/device'
import { useComputers } from '@/lib/queries/computers'
import { HERE, type Computer } from '@/lib/openhut'
import { useComputerProviders } from '@/lib/queries/models'
import { ModelPicker } from '@/components/model-picker'
import { FacePicker } from '@/features/agents/face-picker'
import { AccessPicker, type Access } from '@/features/agents/access'
import { formValues } from '@/lib/form'
import { TOUCH, useMedia } from '@/lib/media'
import { navigate, open, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const NAMES = ['Juniper', 'Scout', 'Pepper', 'Atlas', 'Maple', 'Biscuit', 'Nova', 'Otto']

const PICKER = cn(SOFT_TRIGGER, 'w-[270px] min-w-0 max-w-full gap-2 phone:w-auto phone:flex-1')

export type ModelSteps = ComponentType<{ step: ProviderId | undefined; signing: boolean; prepare: boolean; onSigned: () => void }>

export function NewAgentDialog({ onClose, modelSteps }: { onClose: () => void; modelSteps: ModelSteps }) {
  return <DialogCard onClose={onClose} className="max-h-[calc(100vh-32px)] w-[480px] p-6">
    <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="absolute top-3 right-3 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    <DialogTitle className="text-[15px]/[22px] font-medium">New agent</DialogTitle>
    <AgentForm modelSteps={modelSteps} />
  </DialogCard>
}

// behind: a dialog (New agent, Settings) is open over this page and shows the ?open= key step itself.
export function FirstAgent({ behind = false, modelSteps }: { behind?: boolean; modelSteps: ModelSteps }) {
  return <div className="flex min-h-0 w-full flex-1 flex-col text-center text-ink">
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-6">
      <div className="flex w-[360px] max-w-full flex-col items-center">
        <h1 className="m-0 text-[30px]/[36px] font-bold tracking-[-.03em] text-balance phone:text-[28px]/[34px]">Make your first agent.</h1>
        <p className="m-0 mt-2 max-w-[320px] text-[15px]/[22px] text-balance text-body">Give it a job in your first chat.</p>
        <div className="mt-8 flex w-full flex-col items-center gap-3 text-[13px]/[18px]"><AgentForm steps={!behind} modelSteps={modelSteps} /></div>
      </div>
    </div>
  </div>
}

function AgentForm({ steps = true, modelSteps: Steps }: { steps?: boolean; modelSteps: ModelSteps }) {
  const createAgent = useCreateAgent()
  const touch = useMedia(TOUCH)
  const providers = useComputerProviders('local')
  const [picked, setPicked] = useState<string | null>(null)
  const [runsOn, setRunsOn] = useState(HERE)
  const [access, setAccess] = useState<Access>({ shared: false, people: [] })
  const me = useMe().data?.user
  const computers = runsOnChoices(useComputers().data)
  const [wanted, setWanted] = useState<ProviderId>()
  const [signing, setSigning] = useState(false)
  const opened = useOpen()
  const setup = steps ? stepOf(opened) : undefined
  const taken = new Set(useAgents().data?.map((agent) => agent.name))
  const name = NAMES.find((each) => !taken.has(each)) ?? NAMES[0]
  const admin = useIsAdmin()
  const model = picked ?? firstModel(providers)
  const none = Boolean(providers && !providers.some((provider) => provider.connected))
  const added = wanted && providers?.find((provider) => provider.id === wanted)?.connected
  useEffect(() => {
    if (!added || !wanted) return
    setPicked(firstModel(providers, wanted))
    setWanted(undefined)
    if (setup) open()
  }, [added, wanted, providers, setup])
  const setUp = (id: ProviderId) => {
    setWanted(id)
    if (id === 'claude') setSigning(true)
    else open(id)
  }
  return <form className="flex w-full flex-col items-center gap-4" onSubmit={(event) => {
    if (event.target !== event.currentTarget) return
    const field = formValues(event)
    if (model) createAgent.mutate({ name: field('name').trim() || name, face: field('face'), model, runsOn, ...access })
  }}>
    <Steps step={setup} signing={signing} prepare={none && admin} onSigned={() => setSigning(false)} />
    <FacePicker initial={null} compact />
    <Input name="name" required maxLength={40} defaultValue={name} placeholder={name} aria-label="Name" autoFocus={!touch} autoComplete="off" spellCheck={false} enterKeyHint="go"
      className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-center text-[22px]/[1.3] font-semibold shadow-none focus-visible:ring-0 text-ink outline-none placeholder:text-mute-2" />
    <div className="flex w-full flex-col divide-y divide-hair border-y border-hair text-left">
      <Row title="Model"><ModelPicker providers={providers} value={model} onPick={setPicked} onSetUp={admin ? setUp : undefined} label="Model" className={PICKER} /></Row>
      <Row title="Runs on"><ComputerPicker computers={computers} value={runsOn} onPick={setRunsOn} admin={admin} /></Row>
      <Row title="Access"><AccessPicker owner={me?.email ?? ''} value={access} onChange={setAccess} className={PICKER} /></Row>
      <Row title="Owner"><span className={cn(PICKER, 'pointer-events-none')}>{me && <PersonFace name={me.name} email={me.email} size={16} />}<span className="min-w-0 flex-1 truncate text-left">{me?.name ?? ''}</span></span></Row>
    </div>
    <Button type="submit" variant="primary" className="h-10 w-full justify-center rounded-[10px] text-[15px]" disabled={createAgent.isPending || !model}>{createAgent.isPending ? 'Creating…' : 'Create agent'}</Button>
    <ErrorNote message={createAgent.error?.message} />
  </form>
}

function ComputerPicker({ computers, value, onPick, admin }: { computers: Computer[]; value: string; onPick: (id: string) => void; admin: boolean }) {
  const name = computers.find((computer) => computer.id === value)?.name ?? 'This server'
  return <DropdownMenu>
    <DropdownMenuTrigger className={PICKER} aria-label={`Runs on: ${name}`}>
      <I icon={DEVICE_ICONS.server} size={14} className="shrink-0 text-mute" />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className={FIELD_MENU}>
      {computers.map((computer) => <Pick key={computer.id} icon={DEVICE_ICONS.server} name={computer.name} selected={computer.id === value} onClick={() => onPick(computer.id)}>
        <i title={computer.online ? 'Online' : 'Offline'} className={cn('size-1.5 shrink-0 rounded-full', computer.online ? 'bg-pass' : 'bg-mute-2')} />
      </Pick>)}
      {admin && <Pick icon={PlusSignIcon} name="Add a computer" onClick={() => navigate('/settings/computers?open=add-computer')} />}
    </DropdownMenuContent>
  </DropdownMenu>
}

// One line per item: small icon, name, optional extra (status dot), check when selected.
function Pick({ icon, name, selected = false, onClick, children }: { icon: IconSvgElement; name: string; selected?: boolean; onClick: () => void; children?: ReactNode }) {
  return <DropdownMenuItem className="text-[13px]" onClick={onClick}>
    <I icon={icon} size={14} />
    <span className="min-w-0 truncate text-ink">{name}</span>
    {children}
    <span className="ml-auto grid w-3.5 shrink-0 place-items-center">{selected && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
  </DropdownMenuItem>
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex min-h-12 items-center justify-between gap-3 py-2">
    <span className="w-[72px] shrink-0 text-[13px] font-medium whitespace-nowrap">{title}</span>
    {children}
  </div>
}
