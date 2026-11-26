import { config } from '../../platform/config.ts'
import { settings } from '../../platform/settings.ts'
import { seatLimits } from '../../admin/seat-limits.ts'
import { listed, refuse, type Provider } from './shared.ts'

const PLUGIN = 'claude-subscription-directsdk-experimental'
const MODELS = [
  listed('opus', { name: 'Opus 5.5', note: 'Most capable' }),
  listed('sonnet', { name: 'Sonnet 5.5', note: 'Fast and capable' }),
  listed('haiku', { name: 'Haiku 5.5', note: 'Fastest' }),
]

export const claude: Provider = {
  id: 'claude',
  seed: MODELS,
  connected: () => config.modelMode === 'test' || !!settings.seatToken(),
  listModels: async () => MODELS,
  upstream: {
    name: 'anthropic',
    origin: config.anthropicApi,
    allow: ({ method, path }) => method === 'POST' && (path === '/v1/messages' || path === '/v1/messages/count_tokens'),
    credential: async () => settings.seatToken() || refuse('Claude isn\'t signed in on this computer. Sign in under Settings › Models.'),
    apply: ({ out, secret }) => out.headers.set('authorization', `Bearer ${secret}`),
    observe: (headers) => seatLimits.observe(headers),
  },
  route: ({ model }) => ({ provider: PLUGIN, model }),
  setup: ({ gateway, token }) => ({
    env: { CLAUDE_CODE_OAUTH_TOKEN: token },
    config: { plugins: { entries: { [PLUGIN]: { settings: { relay_upstream: `${gateway}/u/anthropic` } } } } },
  }),
}
