import * as z from 'zod/mini'
import { Place } from '@openhut/common/channels/channel.ts'
import { Thread } from '@openhut/common/threads/thread.ts'


export const Origin = z.object({ platform: z.enum(['app', 'discord', 'webhook', 'routine']), label: z.string(), url: z.optional(z.string()) })
export type Origin = z.infer<typeof Origin>

export const SourcedThread = z.extend(Thread, { origin: z.optional(Origin), place: z.optional(z.nullable(Place)), waiting: z.optional(z.boolean()), readOnly: z.optional(z.boolean()), continueUrl: z.optional(z.nullable(z.string())) })
export type SourcedThread = z.infer<typeof SourcedThread>

export const NotifySettings = z.object({ default: z.nullable(Place), rules: z.string() })
export type NotifySettings = z.infer<typeof NotifySettings>

export const Notified = z.array(z.object({ place: Place, text: z.string() }))
export type Notified = z.infer<typeof Notified>

export function placeKey(place: Place): string {
  return [place.platform, place.chat_id, place.thread_id ?? ''].join(':')
}

export function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  return !!a && !!b && placeKey(a) === placeKey(b)
}

export function placeName(place: Place): string {
  return place.platform === 'discord' || place.platform === 'slack' ? `#${place.chat_name.replace(/^#/, '')}` : place.chat_name
}

export const PLATFORM_WORD: Record<string, string> = { discord: 'Discord', slack: 'Slack', telegram: 'Telegram', whatsapp: 'WhatsApp' }

const SOURCE_WORD: Record<Origin['platform'], string> = { app: 'Web', discord: 'Discord', webhook: 'Webhook', routine: 'Routine' }

export function sourceOf(thread: SourcedThread): { platform: Origin['platform']; word: string; label: string } {
  const origin = thread.origin ?? { platform: 'app', label: '' }
  const label = origin.platform === 'discord' ? `#${origin.label.replace(/^#/, '')}` : origin.label
  return { platform: origin.platform, word: SOURCE_WORD[origin.platform], label: origin.platform === 'app' ? 'Web' : label || SOURCE_WORD[origin.platform] }
}

export function startedIn(thread: SourcedThread): string {
  const source = sourceOf(thread)
  return source.platform === 'discord' ? `Discord ${source.label}` : source.label
}

export const SIDEBAR_THREADS = 3

export function firstThreads(threads: SourcedThread[]): SourcedThread[] {
  const waiting = threads.filter((thread) => thread.waiting)
  return [...waiting, ...threads.filter((thread) => !thread.waiting).slice(0, Math.max(0, SIDEBAR_THREADS - waiting.length))]
}
