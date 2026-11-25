const HASH = /^#(?:([A-Za-z0-9_-]{1,430})#)?(([A-Za-z0-9_-]{8,64})\.[A-Za-z0-9_-]{43})$/
const EMAIL = /^[^\s@]+@[^\s@]+$/

export type Invite = { workspace: string; email: string | undefined; from: string | undefined; team: string | undefined; role: 'admin' | 'member' | undefined }

export function inviteOf(hash: string): Invite | undefined {
  const parsed = HASH.exec(hash)
  if (!parsed?.[2] || !parsed[3]) return undefined
  return { workspace: parsed[3], ...hintOf(parsed[1]) }
}

function hintOf(part: string | undefined): Omit<Invite, 'workspace'> {
  const [email, from, team, role] = decoded(part).split('\n')
  return { email: EMAIL.test(email ?? '') ? email : undefined, from: EMAIL.test(from ?? '') ? from : undefined, team: team?.trim() || undefined, role: role === 'admin' || role === 'member' ? role : undefined }
}

function decoded(part: string | undefined): string {
  if (!part) return ''
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0)))
  } catch {
    return ''
  }
}
