import { MODELS, type ModelId } from '@fastmonkey/common/agents/agent.ts'

export function modelLabel(model: ModelId) {
  return MODELS.find((entry) => entry.id === model)?.label ?? model
}
