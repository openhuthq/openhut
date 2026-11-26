export type SetupStage = 'form' | 'creating' | 'installing' | 'done'

export function setupStage({ started, app }: { started: boolean; app?: { repositories: number | null } | null }): SetupStage {
  if (!app) return started ? 'creating' : 'form'
  return app.repositories ? 'done' : 'installing'
}

export function appName({ owner, host }: { owner: string; host: string }): string {
  const base = owner.trim() || host.split('.').find((part) => !/^(www|app|openhut|localhost|\d+)$/.test(part)) || 'team'
  return `${base}-openhut`.toLowerCase().slice(0, 34)
}

export const slugOf = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')

export type Owner = { login: string; avatarUrl: string; org: boolean }

export function ownerSuggestions({ remembered, orgs }: { remembered: string[]; orgs: Owner[] }): Owner[] {
  const seen = new Set<string>()
  const all = [...remembered.map((login) => ({ login, avatarUrl: avatarUrl(login), org: orgs.some((each) => each.login.toLowerCase() === login.toLowerCase()) })), ...orgs]
  return all.filter((each) => each.login && !seen.has(each.login.toLowerCase()) && seen.add(each.login.toLowerCase()))
}

export function rememberOwner({ owners, owner }: { owners: string[]; owner: string }): string[] {
  const login = owner.trim()
  if (!login) return owners
  return [login, ...owners.filter((each) => each.toLowerCase() !== login.toLowerCase())].slice(0, 5)
}

export const avatarUrl = (login: string): string => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=40`

export function connectStep({ admin, app, started, ready }: { admin: boolean; app: boolean; started: boolean; ready: boolean }): 'setup' | 'connect' | 'ask' {
  if (admin && (!app || (started && !ready))) return 'setup'
  return app ? 'connect' : 'ask'
}
