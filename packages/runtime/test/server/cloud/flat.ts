import type { Box, Letter } from '../../../src/server/platform/cloud.ts'

const ROOMS: Record<string, string> = { 'member-lists': 'member-lists', letters: 'letters', 'join-requests': 'requests', invites: 'invites' }
const SESSIONS: [string, string][] = [['code', '/v1/auth/openhut/session'], ['session', '/v1/auth/openhut/token'], ['join', '/v1/sessions/join']]

export type Request = { url: string; method: string; body: Record<string, unknown>; letters: Letter[]; boxes: Box[] }

export function roomRequest({ url, method = 'GET', body }: { url?: string; method?: string; body: Record<string, unknown> }): Request {
  const parsed = new URL(url ?? '/', 'http://cloud')
  const [, , name = '', ...rest] = parsed.pathname.split('/')
  const plain = { url: url ?? '/', method, body, letters: [], boxes: [] }
  if (parsed.pathname === '/v1/sessions') return { ...plain, url: SESSIONS.find(([field]) => field in body)?.[1] ?? url ?? '/' }
  if (parsed.pathname === '/v1/member-lists' && method === 'POST' && !parsed.searchParams.has('workspace')) {
    const list = body.list as { bytes: string }
    const { workspace } = JSON.parse(Buffer.from(list.bytes, 'base64url').toString()) as { workspace: string }
    return { url: `/v1/workspaces/${workspace}/members`, method: 'PUT', body: list, letters: (body.letters ?? []) as Letter[], boxes: (body.boxes ?? []) as Box[] }
  }
  const workspace = parsed.searchParams.get('workspace')
  if (!workspace || !ROOMS[name]) return plain
  parsed.searchParams.delete('workspace')
  const query = parsed.searchParams.size ? `?${parsed.searchParams}` : ''
  if (name === 'member-lists' && method === 'POST') return { ...plain, url: `/v1/workspaces/${workspace}/members`, method: 'PUT', body: body.list as Record<string, unknown> }
  return { ...plain, url: `/v1/workspaces/${workspace}/${[ROOMS[name], ...rest].join('/')}${query}` }
}
