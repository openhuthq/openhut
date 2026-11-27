import { AiMagicIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { I, ROW, ROW_VALUE } from '@/components/kit'
import { useAgents, useUpdateAgent } from '@/features/agents/api'
import { useComputerProviders } from '@/features/models/api'
import { ModelPicker, ModelValue } from '@/features/models/model-picker'
import { toastError } from '@/lib/toast'
import { Glyph } from '@/components/glyph'
import { find, glyphOf } from '@/features/models/labels'

export function ModelRows({ agent }: { agent: Agent }) {
  const computer = useAgents().data?.find((each) => each.id === agent.id)?.computer ?? 'local'
  const theirs = useComputerProviders(computer)
  const mine = useComputerProviders('local')
  const providers = theirs ?? mine
  const update = useUpdateAgent(agent.id)
  const model = (update.isPending ? update.variables.model : undefined) ?? agent.model
  return <ModelPicker providers={providers} value={model} onPick={(key) => key && update.mutate({ model: key }, { onError: toastError })} disabled={!agent.canEdit} className={ROW} label="Model" title="Model">
    <ModelIcon value={model} providers={providers} />Model<span className={ROW_VALUE}><ModelValue providers={providers} value={model} known={model === agent.model ? agent.modelName : null} /></span>
  </ModelPicker>
}

function ModelIcon({ value, providers }: { value: string | null; providers: Parameters<typeof find>[0]['providers'] }) {
  const { split } = find({ providers, key: value })
  if (!split) return <I icon={AiMagicIcon} size={15} className="text-mute" />
  return <Glyph name={split.provider === 'claude' ? 'claude' : glyphOf(split)} size={15} />
}
