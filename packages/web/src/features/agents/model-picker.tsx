import { MODELS, SIZES, type Agent } from '@openhut/common/agents/agent.ts'
import { Glyph } from '@/components/glyph'
import { SIZE_ICONS } from '@/components/icons'
import { Picker } from '@/components/picker'
import { useUpdateAgent } from '@/features/agents/api'
import { toastError } from '@/lib/toast'

export function ModelPicker({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Picker name="Model" options={MODELS} value={agent.model} iconOf={(_, size) => <Glyph name="claude" size={size} />} disabled={!agent.canEdit} lockReason={lockReason}
    onChoose={(model) => updateAgent.mutate({ model }, { onError: toastError })} />
}

export function SizePicker({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Picker name="Computer" options={SIZES} value={agent.size} iconOf={(id) => SIZE_ICONS[id]} disabled={!agent.canEdit || updateAgent.isPending} lockReason={lockReason}
    note={`How much room ${agent.name} has to work. Changing it restarts ${agent.name}.`} onChoose={(size) => updateAgent.mutate({ size }, { onError: toastError })} />
}
