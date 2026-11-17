import type { ReactNode } from 'react'
import { MODELS, type Agent, type ModelId } from '@openhut/common/agents/agent.ts'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Glyph } from '@/components/glyph'
import { Choice, MenuCard } from '@/components/kit'
import { useUpdateAgent } from '@/features/agents/api'
import { toastError } from '@/lib/toast'

export function modelLabel(agent: Agent) {
  return agent.model === 'codex' ? 'Codex' : MODELS.find((entry) => entry.id === agent.model)?.label ?? agent.model
}

export function ModelIcon({ model, size }: { model: ModelId; size: number }) {
  return <Glyph name={model === 'codex' ? 'openai' : 'claude'} size={size} />
}

export function ModelMenu({ agent, className, align, children }: { agent: Agent; className: string; align?: 'start' | 'end'; children: ReactNode }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <DropdownMenu>
    <DropdownMenuTrigger className={className} disabled={!agent.canEdit} aria-label="Model">{children}</DropdownMenuTrigger>
    <MenuCard title={`${agent.name} thinks with`} align={align}>
      {MODELS.map((model) => <Choice key={model.id} icon={<ModelIcon model={model.id} size={14} />} name={model.id === 'codex' ? 'Codex' : model.label} note={model.id === 'codex' ? 'Coming soon' : 'Claude subscription'}
        selected={agent.model === model.id} disabled={model.id === 'codex'} onClick={() => updateAgent.mutate({ model: model.id }, { onError: toastError })} />)}
    </MenuCard>
  </DropdownMenu>
}
