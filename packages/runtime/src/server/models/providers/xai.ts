import { config } from '../../platform/config.ts'
import { openAiModels } from './openai.ts'
import { keyed } from './shared.ts'

export const xai = keyed({ id: 'xai', origin: config.xaiApi, listModels: (key) => openAiModels({ id: 'xai', origin: config.xaiApi, key }) })
