import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Cancel01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { providerInfo, type ProviderId } from '@openhut/common/models/provider.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I } from '@/components/kit'
import { Glyph } from '@/components/glyph'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { useCloudId, useStartCloud } from '@/features/cloud/api'
import { EntryScreen } from '@/features/cloud/step'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { useComputers } from '@/features/computers/api'
import { useStartSeatSignIn } from '@/features/settings/api'
import { ModelsStep, SeatSignIn, stepOf } from '@/features/settings/models'
import { DEFAULT_MODEL, defaultComputer, firstModel, ONLY_YOU } from '@/features/agents/form'
import { ComputerPicker } from '@/features/computers/computer-picker'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker, SOFT_TRIGGER } from '@/features/models/model-picker'
import { FacePicker } from '@/features/agents/face-picker'
import { Face } from '@/features/agents/face'
import { AccessPicker } from '@/features/agents/access'
import { formValues } from '@/lib/form'
import { TOUCH, useMedia } from '@/lib/media'
import { navigate, open, useOpen } from '@/lib/router'
import type { Computer } from '@/lib/computers'
import { REMOTE } from '@/lib/remote'
import { PROVIDERS_KEY } from '@/lib/query-keys'
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
  const [access, setAccess] = useState(ONLY_YOU)
  const touch = useMedia(TOUCH)
  const { computers, cloud } = useRunsOn()
  const startCloud = useStartCloud()
  const [chosen, setComputer] = useState<string>()
  const computer = (chosen === CLOUD_PICK ? cloud : chosen) ?? (computers.some((each) => each.id !== cloud) ? defaultComputer(computers) : cloud ?? 'local')
  const starting = computer === CLOUD_PICK
  const providers = useComputerProviders(starting ? 'local' : computer)
  const [picked, setPicked] = useState<string | null>(null)
  const [wanted, setWanted] = useState<ProviderId>()
  const seat = useStartSeatSignIn()
  const [signing, setSigning] = useState<{ name: string; face: string } | 'only'>()
  const [queued, setQueued] = useState<{ name: string; face: string }>()
  const client = useQueryClient()
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
  useEffect(() => {
    if (!queued || starting || !providers) return
    const ready = picked ?? firstModel(providers)
    if (!ready) {
      const again = setTimeout(() => void client.invalidateQueries({ queryKey: PROVIDERS_KEY }), 1000)
      return () => clearTimeout(again)
    }
    setQueued(undefined)
    createAgent.mutate({ body: { name: queued.name, face: queued.face, model: ready, ...access, ...(!active.home && { workspace: active.id }) }, computer })
  }, [queued, starting, providers, picked, access, active, computer, createAgent, client])
  const where = computers.find((each) => each.id === computer) ?? computers[0]
  if (queued) return <StartingCloud agent={queued} error={startCloud.error?.message} onRetry={() => startCloud.mutate()} />
  return <form className="flex w-full flex-col items-center gap-4" onSubmit={(event) => {
    const field = formValues(event)
    const typed = { name: field('name').trim() || name, face: field('face') }
    if (starting) {
      if (!startCloud.isPending && !startCloud.isSuccess) startCloud.mutate()
      return setQueued(typed)
    }
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
        <ComputerPicker computers={computers} value={computer} cloud={cloud} onPick={(id) => { setComputer(id); setPicked(null) }} onAdd={() => navigate('/settings/computers?open=add')} title="It runs on" className={PICKER} />
      </Row>}
      {(providers || !starting) && <Row title="Model">
        <ModelPicker providers={providers} value={model} onPick={setPicked} onSetUp={setUp} label="Model" title="It thinks with" className={PICKER}>
          {unready ? <NeedsSignIn model={model} /> : undefined}
        </ModelPicker>
      </Row>}
      {email && <Row title="Access"><AccessPicker workspace={active} owner={email} value={access} onChange={setAccess} className={PICKER} /></Row>}
    </div>
    <Button type="submit" variant="primary" className="h-10 w-full justify-center rounded-[10px] text-[15px]" disabled={createAgent.isPending || (!providers && !starting)}>{createAgent.isPending ? 'Creating…' : 'Create agent'}</Button>
    <ErrorNote message={createAgent.error?.message} />
  </form>
}

// "Runs on" choices: the person's computers, with their Cloud computer named Cloud, or a Cloud choice that starts one (web App only).
const CLOUD_PICK = 'cloud'
function useRunsOn(): { computers: Computer[]; cloud?: string } {
  const computers = useComputers().data ?? []
  const joinedId = useCloudId(computers)
  if (!REMOTE) return { computers }
  const cloud = joinedId ?? CLOUD_PICK
  const joined = !!joinedId
  const listed = joined ? computers.map((each) => each.id === cloud ? { ...each, name: 'Cloud' } : each)
    : [...computers, { id: cloud, name: 'Cloud', kind: 'server' as const, url: '', online: true, features: { whatsapp: false, browser: false }, runtimeTooOld: false }]
  return { computers: listed, cloud: joined ? cloud : CLOUD_PICK }
}

// Creating the first agent on Cloud starts Cloud; the agent waits here, like its chat does, until Cloud joins.
function StartingCloud({ agent, error, onRetry }: { agent: { name: string; face: string }; error?: string; onRetry: () => void }) {
  return <div className="flex flex-col items-center gap-2 py-8 text-center">
    <span className={cn(!error && 'animate-pulse')}><Face agent={{ id: agent.name, instructions: '', face: agent.face }} size={64} /></span>
    <h3 className="mt-2 mb-0 text-[20px]/[1.3] font-semibold text-ink">{error ? 'Couldn’t start Cloud' : 'Starting Cloud…'}</h3>
    <p className="m-0 text-[14px]/[1.5] text-balance text-body">{error ?? `${agent.name} is ready to chat in a minute or two.`}</p>
    {error && <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>}
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
