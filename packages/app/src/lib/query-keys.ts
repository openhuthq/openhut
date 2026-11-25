export const ME_KEY = ['me']
export const AGENTS_KEY = ['agents']
export const CONNECTIONS_KEY = ['connections']
export const GRANTS_KEY = ['grants']
export const THREADS_KEY = ['threads']

export function grantsKey(filter: { agentId: string } | { connectionId: string }) {
  return [...GRANTS_KEY, filter]
}
export const COMPUTERS_KEY = ['computers']
export const PROVIDERS_KEY = ['providers']
export const CREDITS_KEY = ['credits']
