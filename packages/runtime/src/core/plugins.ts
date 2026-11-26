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
import { inbox } from '../plugins/inbox/index.ts'
import { post } from '../plugins/post/index.ts'
import { cards } from '../plugins/cards/index.ts'
import { subagents } from '../plugins/subagents/index.ts'
import { HttpError } from '../server/platform/http-error.ts'
import type { Plugin } from './plugin.ts'

let list: Plugin[] | undefined

export const plugins = (): Plugin[] => list ??= checked([base, models, chat, channels, self, connections, keys, browser, onboarding, asks, inbox, post, cards, subagents])

export function checked(list: Plugin[]): Plugin[] {
  const names = list.flatMap((plugin) => Object.keys(plugin.tools ?? {}))
  const clash = names.find((name, index) => names.indexOf(name) !== index)
  if (clash) throw new HttpError(500, `Two plugins define the tool ${clash}.`)
  return list
}
