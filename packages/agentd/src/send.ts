export const SEND_TARGET = /^[a-z]+:[\w@.#:+-]{1,200}$/
export const MAX_SEND_BYTES = 32_000

export type SendTarget = { id: string; platform: string; name: string; type: string }

export function targetsOf(listed: unknown): SendTarget[] {
  const platforms = isRecord(listed) && isRecord(listed.platforms) ? listed.platforms : {}
  return Object.entries(platforms).flatMap(([platform, chats]) => (Array.isArray(chats) ? chats : []).filter(isRecord).map((chat) => ({
    id: `${platform}:${String(chat.id)}${chat.thread_id ? `:${String(chat.thread_id)}` : ''}`, platform, name: String(chat.name ?? chat.id), type: String(chat.type ?? ''),
  })).filter((target) => SEND_TARGET.test(target.id)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
