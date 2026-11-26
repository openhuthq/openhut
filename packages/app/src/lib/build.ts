let first: string | undefined
let stale = false

export const STALE_MESSAGE = 'OpenHut updated. Reload the page to keep going.'

export function noteBuild(build: string | null): boolean {
  if (!build || stale) return false
  first ??= build
  stale = build !== first
  return stale
}

export const isStale = (): boolean => stale
