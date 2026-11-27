import { AGENT_DIALOGS, type AgentDialog } from '../config/paths.ts'

export type Route =
  | { page: 'home'; adding: boolean }
  | { page: 'agent'; agentId: string; dialog: AgentDialog | undefined; detail: string | undefined; threadId?: string; artifactId?: string }
  | { page: 'connections' }
  | { page: 'settings'; tab: string }
  | { page: 'missing' }

const DETAILED = new Set<AgentDialog>(['skills', 'routines', 'apps', 'setup'])

const MISSING: Route = { page: 'missing' }

export function routeOf(path: string): Route {
  const [section = '', id = '', dialog = '', detail = '', ...rest] = path.split('/').slice(1).map(decodeURIComponent)
  if (section === 'connections') return { page: 'connections' }
  if (section === 'settings') return { page: 'settings', tab: id || 'people' }
  if (section === 'agents' && dialog === 'threads' && detail && rest.length === 2 && rest[0] === 'a' && rest[1]) return { page: 'agent', agentId: id, dialog: undefined, detail: undefined, threadId: detail, artifactId: rest[1] }
  if (rest.length) return MISSING
  if (section === '' || (section === 'agents' && !id)) return { page: 'home', adding: false }
  if (section === 'new' && !id) return { page: 'home', adding: true }
  if (section !== 'agents') return MISSING
  if (dialog === 'threads' && detail) return { page: 'agent', agentId: id, dialog: undefined, detail: undefined, threadId: detail }
  if (dialog === 'a' && detail) return { page: 'agent', agentId: id, dialog: undefined, detail: undefined, artifactId: detail }
  if (!dialog) return { page: 'agent', agentId: id, dialog: undefined, detail: undefined }
  const known = AGENT_DIALOGS.find((each) => each === dialog)
  if (!known || (detail && !DETAILED.has(known))) return MISSING
  return { page: 'agent', agentId: id, dialog: known, detail: detail || undefined }
}
