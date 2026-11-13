import type { AdminForm } from '@/features/admin/admin-page'
import type { AgentDialog } from '@/features/agents/agent-page'
import { integration } from '@/features/connections/catalog'

const AGENT_DIALOGS: AgentDialog[] = ['name', 'instructions', 'slack', 'whatsapp', 'telegram']
const ADMIN_FORMS: AdminForm[] = ['seat', 'public-url', 'google', 'containers']
const MISSING: Route = { page: 'missing' }

export function routeOf(path: string): Route {
  const [section = '', id = '', detail = '', ...rest] = path.split('/').slice(1)
  if (rest.length) return MISSING
  switch (section) {
    case '': return { page: 'home' }
    case 'login': return id ? MISSING : { page: 'login' }
    case 'setup': return id ? MISSING : { page: 'setup' }
    case 'invite': return id && !detail ? { page: 'invite', token: decodeURIComponent(id) } : MISSING
    case 'mcp': return id === 'authorize' && !detail ? { page: 'mcp-authorize' } : MISSING
    case 'agents': return agentRoute(id, detail)
    case 'connections': return connectionRoute(id, detail)
    case 'people': return peopleRoute(id, detail)
    case 'admin': return adminRoute(id, detail)
    default: return MISSING
  }
}

function agentRoute(id: string, detail: string): Route {
  if (!id) return { page: 'agents' }
  if (!detail) return { page: 'agent', agentId: decodeURIComponent(id), dialog: undefined }
  if (detail === 'chat') return { page: 'chat', agentId: decodeURIComponent(id) }
  const dialog = AGENT_DIALOGS.find((name) => name === detail)
  return dialog ? { page: 'agent', agentId: decodeURIComponent(id), dialog } : MISSING
}

function connectionRoute(id: string, detail: string): Route {
  if (id === 'new') return integration(detail || 'postgres') ? { page: 'connections', adding: detail || 'postgres' } : MISSING
  if (detail) return MISSING
  if (!id) return { page: 'connections', adding: undefined }
  if (id === 'tailscale') return { page: 'tailscale' }
  return { page: 'connection', connectionId: decodeURIComponent(id) }
}

function peopleRoute(id: string, detail: string): Route {
  if (detail || (id && id !== 'invite')) return MISSING
  return { page: 'people', inviting: id === 'invite' }
}

function adminRoute(id: string, detail: string): Route {
  if (detail) return MISSING
  if (!id) return { page: 'admin', form: undefined }
  const form = ADMIN_FORMS.find((name) => name === id)
  return form ? { page: 'admin', form } : MISSING
}

export type Route =
  | { page: 'home' }
  | { page: 'login' }
  | { page: 'setup' }
  | { page: 'invite'; token: string }
  | { page: 'mcp-authorize' }
  | { page: 'agents' }
  | { page: 'agent'; agentId: string; dialog: AgentDialog | undefined }
  | { page: 'chat'; agentId: string }
  | { page: 'connections'; adding: string | undefined }
  | { page: 'tailscale' }
  | { page: 'connection'; connectionId: string }
  | { page: 'people'; inviting: boolean }
  | { page: 'admin'; form: AdminForm | undefined }
  | { page: 'missing' }
