import type { ProviderId } from '@openhut/common/models/provider.ts'
import { claude } from './claude.ts'
import { codex } from './codex.ts'
import { openai } from './openai.ts'
import { openrouter } from './openrouter.ts'
import { xai } from './xai.ts'
import type { Provider } from './shared.ts'

export type { ListedModel, Provider, Route, Setup } from './shared.ts'

const FAST_NAME = /\b(mini|nano|flash|haiku|lite|small|fast)\b/i

export const providers: Record<ProviderId, Provider> = { claude, codex, openrouter, openai, xai }

export function tierOf(id: string): 'big' | 'fast' {
  return FAST_NAME.test(id) ? 'fast' : 'big'
}
