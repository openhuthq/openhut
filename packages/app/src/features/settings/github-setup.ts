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
