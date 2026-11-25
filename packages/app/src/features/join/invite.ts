const HASH = /^#(?:([A-Za-z0-9_-]{1,430})#)?(([A-Za-z0-9_-]{8,64})\.[A-Za-z0-9_-]{43})$/
const EMAIL = /^[^\s@]+@[^\s@]+$/

export const INVITE_PAGE = 'https://openhut.dev/join'

export type Invite = { link: string; workspace: string; email: string | undefined; from: string | undefined; team: string | undefined }

export function inviteOf(hash: string): Invite | undefined {
  const parsed = HASH.exec(hash)
  if (!parsed?.[2] || !parsed[3]) return undefined
  return { link: `${INVITE_PAGE}#${parsed[2]}`, workspace: parsed[3], ...hintOf(parsed[1]) }
}

function hintOf(part: string | undefined): { email: string | undefined; from: string | undefined; team: string | undefined } {
  const [email, from, team] = decoded(part).split('\n')
  return { email: EMAIL.test(email ?? '') ? email : undefined, from: EMAIL.test(from ?? '') ? from : undefined, team: team?.trim() || undefined }
}

function decoded(part: string | undefined): string {
  if (!part) return ''
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0)))
  } catch {
    return ''
  }
}
