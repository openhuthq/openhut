import type { Cloud } from '@openhut/common/cloud/cloud.ts'

const KEY = 'openhut.seen-devices'
const ALERT_MS = 3 * 24 * 60 * 60_000
const listeners = new Set<() => void>()
let seen = read()

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}

export const seenDevices = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  get: () => seen,
}

export function markSeen(keys: string[]): void {
  seen = [...seen, ...keys]
  listeners.forEach((listener) => listener())
  try { localStorage.setItem(KEY, JSON.stringify(seen)) } catch { return }
}

export function freshDevice({ cloud, seen, now }: { cloud: Cloud; seen: string[]; now: number }): Cloud['devices'][number] | undefined {
  const since = Date.parse(cloud.devices.find((device) => device.here)?.addedAt ?? '') || 0
  return cloud.devices.find((device) => !device.here && device.addedAt && Date.parse(device.addedAt) > since && now - Date.parse(device.addedAt) < ALERT_MS && !seen.includes(device.key))
}

type Workspace = Cloud['workspaces'][number]
export type JoinRequest = { workspace: Workspace; request: Workspace['requests'][number]; mine: boolean; path: string }

export function joinRequests({ cloud }: { cloud: Cloud }): JoinRequest[] {
  if (cloud.status !== 'on' && cloud.status !== 'offline') return []
  return cloud.workspaces.flatMap((workspace) => workspace.requests
    .filter((request) => workspace.own && workspace.home ? request.email === cloud.email : workspace.role !== 'member' && request.email !== cloud.email)
    .map((request) => ({ workspace, request, mine: request.email === cloud.email, path: request.email === cloud.email ? '/settings/computers' : '/settings/people' })))
}
