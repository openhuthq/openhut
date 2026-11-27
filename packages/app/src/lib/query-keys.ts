export const ME_KEY = ['me']
export const AGENTS_KEY = ['agents']
export const CONNECTIONS_KEY = ['connections']
export const GRANTS_KEY = ['grants']
export const THREADS_KEY = ['threads']
export const PEOPLE_KEY = ['people']

export function grantsKey(filter: { agentId: string } | { connectionId: string }) {
  return [...GRANTS_KEY, filter]
}
export const COMPUTERS_KEY = ['computers']
export const PROVIDERS_KEY = ['providers']

export function agentKey(agentId: string) {
  return [...AGENTS_KEY, agentId]
}

export function connectionToolsKey(connectionId: string) {
  return ['connection-tools', connectionId]
}

export function agentToolsKey({ agentId, connectionId }: { agentId: string; connectionId: string }) {
  return ['agent-tools', agentId, connectionId]
}

export function agentEventsKey(agentId: string) {
  return ['agent-events', agentId]
}

export function routinesKey(agentId: string) {
  return ['routines', agentId]
}

export function webhooksKey(agentId: string) {
  return ['webhooks', agentId]
}

export function asksKey(agentId: string) {
  return ['asks', agentId]
}

export const INSTALL_SETTINGS_KEY = ['install-settings']
