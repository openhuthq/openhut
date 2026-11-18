import { AiMagicIcon, ArrowRight01Icon, Cancel01Icon, Route01Icon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons'
import { HELPER_TASKS, type Agent, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import { Dialog, DialogHead } from '@/components/ui/dialog'
import { I, ROW, ROW_VALUE } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { useComputerProviders } from '@/features/models/api'
import { HelperRows } from '@/features/models/helper-rows'
import { automatic } from '@/features/models/labels'
import { ModelPicker, ModelValue } from '@/features/models/model-picker'
import { toastError } from '@/lib/toast'

const NO_FALLBACK = { name: 'No fallback', note: 'It stops answering until the model is back' }

function useAgentModels(agent: Agent) {
  const computer = useAgents().data?.find((each) => each.id === agent.id)?.computer ?? 'local'
  const providers = useComputerProviders(computer)
  const update = useUpdateAgent(agent.id)
  const change = (patch: UpdateAgent) => update.mutate(patch, { onError: toastError })
  const pending = update.isPending ? update.variables : undefined
  return {
    providers, change, locked: !agent.canEdit,
    model: pending?.model ?? agent.model,
    fallback: pending?.fallbackModel === undefined ? agent.fallbackModel : pending.fallbackModel,
  }
}

export function ModelRows({ agent }: { agent: Agent }) {
  const { providers, change, locked, model, fallback } = useAgentModels(agent)
  const set = HELPER_TASKS.filter((task) => agent.helperModels[task.slot]).length
  return <>
    <ModelPicker providers={providers} value={model} onPick={(key) => key && change({ model: key })} disabled={locked} className={ROW} label="Model" title={`${agent.name} thinks with`}>
      <I icon={AiMagicIcon} size={15} className="text-mute" />Model<span className={ROW_VALUE}><ModelValue providers={providers} value={model} /></span>
    </ModelPicker>
    <ModelPicker providers={providers} value={fallback} exclude={model} onPick={(key) => change({ fallbackModel: key })} disabled={locked} className={ROW} label="Fallback model" title={`If ${agent.name} can’t answer, it tries`}
      none={{ ...NO_FALLBACK, icon: <I icon={Cancel01Icon} size={14} /> }}>
      <I icon={Route01Icon} size={15} className="text-mute" />Fallback<span className={ROW_VALUE}><ModelValue providers={providers} value={fallback} none={{ ...NO_FALLBACK, icon: null }} /></span>
    </ModelPicker>
    <a className={ROW} href={agentPath({ agentId: agent.id, dialog: 'helpers' })}><I icon={SlidersHorizontalIcon} size={15} className="text-mute" />Helper models<span className={ROW_VALUE}>{set ? `${set} of ${HELPER_TASKS.length} set` : 'Automatic'}<I icon={ArrowRight01Icon} size={12} className="text-mute" /></span></a>
  </>
}

export function HelperModelsSheet({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { providers, change, locked, model } = useAgentModels(agent)
  const auto = automatic({ providers, key: model })
  return <Dialog size="sheet" label="Helper models" onClose={onClose} className="flex flex-col">
    <DialogHead title="Helper models" subtitle={`Small jobs ${agent.name} does in the background. Automatic picks a fast model from the same provider as its main one, which is ${auto.name} today.`} onClose={onClose} />
    <div className="flex flex-1 flex-col gap-5 overflow-auto px-5 py-4">
      <HelperRows providers={providers} main={model} values={agent.helperModels} who={agent.name} disabled={locked} onPick={(slot, key) => change({ helperModels: { [slot]: key } })} />
    </div>
    <p className="m-0 px-5 py-4 text-[12px] text-mute">Changing a model restarts {agent.name} for a few seconds.</p>
  </Dialog>
}
