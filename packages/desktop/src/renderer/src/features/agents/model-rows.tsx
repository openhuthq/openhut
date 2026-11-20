import { AiMagicIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { I, ROW, ROW_VALUE } from '@/components/kit'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker, ModelValue } from '@/features/models/model-picker'
import { toastError } from '@/lib/toast'

export function ModelRows({ agent }: { agent: Agent }) {
  const computer = useAgents().data?.find((each) => each.id === agent.id)?.computer ?? 'local'
  const providers = useComputerProviders(computer)
  const update = useUpdateAgent(agent.id)
  const model = (update.isPending ? update.variables.model : undefined) ?? agent.model
  return <ModelPicker providers={providers} value={model} onPick={(key) => key && update.mutate({ model: key }, { onError: toastError })} disabled={!agent.canEdit} className={ROW} label="Model" title={`${agent.name} thinks with`}>
    <I icon={AiMagicIcon} size={15} className="text-mute" />Model<span className={ROW_VALUE}><ModelValue providers={providers} value={model} /></span>
  </ModelPicker>
}
