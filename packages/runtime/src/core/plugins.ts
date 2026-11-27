import { base } from '../plugins/base/index.ts'
import { models } from '../plugins/models/index.ts'
import { chat } from '../plugins/chat/index.ts'
import { channels } from '../plugins/channels/index.ts'
import { self } from '../plugins/self/index.ts'
import { connections } from '../plugins/connections/index.ts'
import { keys } from '../plugins/keys/index.ts'
import { browser } from '../plugins/browser/index.ts'
import { onboarding } from '../plugins/onboarding/index.ts'
import { inbox } from '../plugins/inbox/index.ts'
import { post } from '../plugins/post/index.ts'
import { cards } from '../plugins/cards/index.ts'
import { subagents } from '../plugins/subagents/index.ts'
import { github } from '../plugins/github/index.ts'
import { HttpError } from '../server/platform/http-error.ts'
import type { Plugin } from './plugin.ts'
import { asksPlugin } from './asks.ts'

let list: Plugin[] | undefined

export const plugins = (): Plugin[] => list ??= ordered()

export const startPlugins = (): void => { for (const plugin of plugins()) plugin.start?.() }

function ordered(): Plugin[] {
  const before = [base, models, chat, channels, self, connections, keys, browser, onboarding]
  const after = [inbox, post, cards, subagents, github]
  return checked([...before, asksPlugin([...before, ...after]), ...after])
}

export function checked(list: Plugin[]): Plugin[] {
  const names = list.flatMap((plugin) => Object.keys(plugin.tools ?? {}))
  const clash = names.find((name, index) => names.indexOf(name) !== index)
  if (clash) throw new HttpError(500, `Two plugins define the tool ${clash}.`)
  const prefixes = list.flatMap((plugin) => Object.keys(plugin.routes?.() ?? {}))
  const shared = prefixes.find((prefix, index) => prefixes.indexOf(prefix) !== index)
  if (shared) throw new HttpError(500, `Two plugins serve ${shared}.`)
  return list
}
