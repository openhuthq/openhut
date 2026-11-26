import { base } from '../plugins/base/index.ts'
import { models } from '../plugins/models/index.ts'
import { chat } from '../plugins/chat/index.ts'
import { channels } from '../plugins/channels/index.ts'
import { self } from '../plugins/self/index.ts'
import { connections } from '../plugins/connections/index.ts'
import { keys } from '../plugins/keys/index.ts'
import { browser } from '../plugins/browser/index.ts'
import { onboarding } from '../plugins/onboarding/index.ts'
import { asks } from '../plugins/asks/index.ts'
import { cards } from '../plugins/cards/index.ts'
import type { Plugin } from './plugin.ts'

export const plugins: Plugin[] = [base, models, chat, channels, self, connections, keys, browser, onboarding, asks, cards]
