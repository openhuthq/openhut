import type { Cloud } from '@openhut/common/cloud/cloud.ts'

type Workspace = Cloud['workspaces'][number]
export type JoinRequest = { workspace: Workspace; request: Workspace['requests'][number]; mine: boolean; path: string }

export function joinRequests({ cloud }: { cloud: Cloud }): JoinRequest[] {
  return cloud.workspaces.flatMap((workspace) => workspace.requests
    .filter((request) => workspace.own && workspace.home ? request.email === cloud.email : workspace.role !== 'member' && request.email !== cloud.email)
    .map((request) => ({ workspace, request, mine: request.email === cloud.email, path: request.email === cloud.email ? '/settings/computers' : '/settings/people' })))
}

const KNOWN = 'openhut.devices.known'

export function knownDevices(): Set<string> | null {
  try {
    const raw = localStorage.getItem(KNOWN)
    return raw === null ? null : new Set(JSON.parse(raw) as string[])
  } catch {
    return null
  }
}

export function rememberDevices(keys: string[]): void {
  try {
    localStorage.setItem(KNOWN, JSON.stringify([...new Set([...(knownDevices() ?? []), ...keys])]))
  } catch {
    return
  }
}

export function newDevices({ devices, known }: { devices: Cloud['devices']; known: Set<string> | null }): Cloud['devices'] {
  const since = Date.parse(devices.find((device) => device.here)?.addedAt ?? '')
  if (!known || Number.isNaN(since)) return []
  return devices.filter((device) => !device.here && device.kind === 'mac' && !known.has(device.key) && Date.parse(device.addedAt ?? '') > since)
}

export function goneNotice({ name, why, owner }: Cloud['gone'][number]): { title: string; note: string } {
  if (why === 'deleted') return { title: `${name} was deleted`, note: 'Its agents moved to the trash on this computer.' }
  if (!owner) return { title: `You were removed from ${name}`, note: 'Its agents moved to the trash on this computer.' }
  const who = nameOf(owner)
  return { title: `${who} removed this computer from ${name}`, note: `Ask ${who} to invite you again if that’s a mistake.` }
}

export function nameOf(email: string): string {
  const first = (email.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}
