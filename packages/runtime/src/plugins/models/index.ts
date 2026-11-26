import { definePlugin } from '../../core/plugin.ts'
import { config } from '../../server/platform/config.ts'
import { providers } from '../../server/models/providers/index.ts'
import type { Slot } from '../../server/models/model-slots.ts'
import { providerController } from '../../server/models/provider-controller.ts'

const AUXILIARY = ['approval', 'compression', 'title_generation', 'background_review']
const TEST_CONTEXT = 200_000

export const models = definePlugin({
  name: 'models',
  routes: () => ({ '/api/providers': providerController }),
  hermes: ({ agent, gateway, token }) => {
    const setup = providers[agent.slots.primary.provider].setup({ gateway, token })
    return {
      config: { ...modelConfig({ gateway, token, slot: agent.slots.primary }), ...setup.config },
      env: config.modelMode === 'test' ? {} : setup.env,
      auth: config.modelMode === 'claude' ? setup.auth : undefined,
    }
  },
})

function modelConfig({ gateway, token, slot }: { gateway: string; token: string; slot: Slot }): Record<string, unknown> {
  if (config.modelMode === 'test') return { model: { default: `openhut-test-${slot.model}`, provider: 'custom', base_url: `${gateway}/test-llm/v1`, api_key: token, context_length: TEST_CONTEXT } }
  const route = providers[slot.provider].route({ gateway, token, model: slot.model, contextLength: slot.contextLength })
  const reach = { provider: route.provider, base_url: route.baseUrl, api_key: route.apiKey }
  return {
    model: { default: route.model, ...reach, context_length: route.contextLength ?? undefined },
    auxiliary: Object.fromEntries(AUXILIARY.map((task) => [task, { model: route.model, ...reach }])),
  }
}
