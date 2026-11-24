import { useEffect, useState, type ReactNode } from 'react'
import { Cancel01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { providerInfo, type ProviderId } from '@openhut/common/models/provider.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I } from '@/components/kit'
import { Glyph } from '@/components/glyph'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { EntryScreen } from '@/features/cloud/step'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { useComputers } from '@/features/computers/api'
import { useStartSeatSignIn } from '@/features/settings/api'
import { ModelsStep, SeatSignIn, stepOf } from '@/features/settings/models'
import { DEFAULT_MODEL, defaultComputer, firstModel } from '@/features/agents/form'
import { ComputerPicker } from '@/features/computers/computer-picker'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker, SOFT_TRIGGER } from '@/features/models/model-picker'
import { FacePicker } from '@/features/agents/face-picker'
import { AccessPicker, type AccessValue } from '@/features/agents/access'
import { formValues } from '@/lib/form'
import { TOUCH, useMedia } from '@/lib/media'
import { navigate, open, useOpen } from '@/lib/router'
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
  return <EntryScreen art={null} title="Make your first agent." line="Give it a job in your first chat.">
    <AgentForm />
  </EntryScreen>
}

function AgentForm() {
  const createAgent = useCreateAgent()
  const { active, email } = useWorkspaces()
  const [access, setAccess] = useState<AccessValue>({ shared: false, people: [], sidebars: [] })
  const touch = useMedia(TOUCH)
  const computers = useComputers().data ?? []
  const [chosen, setComputer] = useState<string>()
  const computer = chosen ?? defaultComputer(computers)
  const providers = useComputerProviders(computer)
  const [picked, setPicked] = useState<string | null>(null)
  const [wanted, setWanted] = useState<ProviderId>()
  const seat = useStartSeatSignIn()
  const [signing, setSigning] = useState<{ name: string; face: string } | 'only'>()
  const setup = stepOf(useOpen())
  const taken = new Set(useAgents().data?.map((agent) => agent.name))
  const name = NAMES.find((each) => !taken.has(each)) ?? NAMES[0]
  const model = picked ?? firstModel(providers) ?? DEFAULT_MODEL
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
  const create = ({ name, face }: { name: string; face: string }) => createAgent.mutate({ body: { name, face, model, ...access, ...(!active.home && { workspace: active.id }) }, computer })
  const where = computers.find((each) => each.id === computer) ?? computers[0]
  return <form className="flex w-full flex-col items-center gap-4" onSubmit={(event) => {
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
      {where && <Row title="Runs on">
        <ComputerPicker computers={computers} value={computer} onPick={(id) => { setComputer(id); setPicked(null) }} onAdd={() => navigate('/settings/computers?open=add')} title="It runs on" className={PICKER} />
      </Row>}
      <Row title="Model">
        <ModelPicker providers={providers} value={model} onPick={setPicked} onSetUp={setUp} label="Model" title="It thinks with" className={PICKER}>
          {unready ? <NeedsSignIn model={model} /> : undefined}
        </ModelPicker>
      </Row>
      {email && <Row title="Access"><AccessPicker workspace={active} owner={email} value={access} onChange={setAccess} className={PICKER} /></Row>}
    </div>
    <Button type="submit" variant="primary" className="h-10 w-full justify-center rounded-[10px] text-[15px]" disabled={createAgent.isPending || !providers}>{createAgent.isPending ? 'Creating…' : 'Create agent'}</Button>
    <ErrorNote message={createAgent.error?.message} />
  </form>
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
    <span className="w-16 shrink-0 text-[13px] font-medium">{title}</span>
    {children}
  </div>
}
