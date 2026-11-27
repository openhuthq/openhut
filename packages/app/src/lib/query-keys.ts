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

export function agentToolsKey(agentId: string) {
  return ['agent-tools', agentId]
}

export function agentConnectionToolsKey({ agentId, connectionId }: { agentId: string; connectionId: string }) {
  return [...agentToolsKey(agentId), connectionId]
}

export function agentEventsKey(agentId: string) {
  return ['agent-events', agentId]
}

export const ROUTINES_KEY = ['routines']

export function routinesKey(agentId: string) {
  return [...ROUTINES_KEY, agentId]
}

export function webhooksKey(agentId: string) {
  return ['webhooks', agentId]
}

export const ASKS_KEY = ['asks']

export function asksKey(agentId: string) {
  return [...ASKS_KEY, agentId]
}

export const INSTALL_SETTINGS_KEY = ['install-settings']

export function agentSecretsKey(agentId: string) {
  return ['agent-secrets', agentId]
}

export function notifyKey(agentId: string) {
  return ['notify', agentId]
}

export function placesKey(agentId: string) {
  return ['places', agentId]
}

export function agentFaceKey(agentId: string) {
  return ['agent-face', agentId]
}

export const GITHUB_APP_KEY = ['github-app']
export const GITHUB_INSTALLATIONS_KEY = ['github-installations']

export function githubWaitsKey(askId: string) {
  return ['github-waits', askId]
}

export function githubPublicOrgsKey(login: string) {
  return ['github-public-orgs', login.toLowerCase()]
}

export const UPDATES_KEY = [...COMPUTERS_KEY, 'updates']

export function webhookSetupKey({ agentId, webhookId }: { agentId: string; webhookId: string }) {
  return [...webhooksKey(agentId), webhookId, 'setup']
}

export const THREAD_KEY = [...THREADS_KEY, 'thread']

export function threadKey(threadId: string) {
  return [...THREAD_KEY, threadId]
}

export const CHANNELS_KEY = ['channels']

export function channelsKey(agentId: string) {
  return [...CHANNELS_KEY, agentId]
}

export function conversationsKey(channelId: string) {
  return ['conversations', channelId]
}

export const SKILLS_KEY = ['skills']
export const SKILL_KEY = ['skill']

export function skillsKey(agentId: string) {
  return [...SKILLS_KEY, agentId]
}

export function skillKey(skillId: string) {
  return [...SKILL_KEY, skillId]
}

export const MEMORY_KEY = ['memory']

export function memoryKey(agentId: string) {
  return [...MEMORY_KEY, agentId]
}

export const SETUP_KEY = ['setup']

export function inviteKey(token: string) {
  return ['invite', token]
}

export const INVITES_KEY = ['invites']
export const ADMIN_KEY = ['admin']
export const SEAT_USAGE_KEY = ['seat-usage']

export function codexSignInKey(id: string | undefined) {
  return ['codex-sign-in', id]
}

export function connectionKey(connectionId: string) {
  return [...CONNECTIONS_KEY, connectionId]
}

export function deliveryTargetsKey(agentId: string) {
  return ['delivery-targets', agentId]
}

export function homeFilesKey({ threadId, paths }: { threadId: string; paths: string[] }) {
  return [...THREADS_KEY, 'files', threadId, paths]
}

export function thumbKey({ agentId, path }: { agentId: string; path: string }) {
  return [...THREADS_KEY, 'thumb', agentId, path]
}

export function computerAdminsKey(computerId: string | undefined) {
  return [...COMPUTERS_KEY, 'admins', computerId]
}
