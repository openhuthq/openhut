const HASH = /^#(?:([A-Za-z0-9_-]{1,430})#)?(([A-Za-z0-9_-]{8,64})\.[A-Za-z0-9_-]{43})$/
const EMAIL = /^[^\s@]+@[^\s@]+$/

export const INVITE_PAGE = 'https://openhut.dev/join'

type Bridge = { invite?: { forget: () => Promise<unknown>; keep?: (path: string) => Promise<unknown>; clearClipboard: () => Promise<unknown> } }

export type Invite = { link: string; workspace: string; email: string | undefined }

export function inviteOf(hash: string): Invite | undefined {
  const parsed = HASH.exec(hash)
  if (!parsed?.[2] || !parsed[3]) return undefined
  return { link: `${INVITE_PAGE}#${parsed[2]}`, workspace: parsed[3], email: emailOf(parsed[1]) }
}

export function forgetInvite() {
  const bridge: Bridge | undefined = Reflect.get(globalThis, 'openhut')
  void bridge?.invite?.forget().catch(() => undefined)
}

export function keepInvite(path: string) {
  const bridge: Bridge | undefined = Reflect.get(globalThis, 'openhut')
  void bridge?.invite?.keep?.(path).catch(() => undefined)
}

export function clearCarriedInvite() {
  const bridge: Bridge | undefined = Reflect.get(globalThis, 'openhut')
  void bridge?.invite?.clearClipboard().catch(() => undefined)
}

function emailOf(part: string | undefined): string | undefined {
  if (!part) return undefined
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0)))
    return EMAIL.test(text) ? text : undefined
  } catch {
    return undefined
  }
}
