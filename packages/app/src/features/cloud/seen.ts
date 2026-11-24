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

const DISMISSED = 'openhut.gone.dismissed'

export function goneKey({ name, owner }: Cloud['gone'][number]): string {
  return `${name}\n${owner ?? ''}`
}

export function dismissedGone(): string {
  try {
    return localStorage.getItem(DISMISSED) ?? '[]'
  } catch {
    return '[]'
  }
}

export function dismissGone(key: string): void {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...JSON.parse(dismissedGone()) as string[], key])]))
  } catch {
    return
  }
  window.dispatchEvent(new Event(DISMISSED))
}

export function onGoneDismissed(listener: () => void): () => void {
  window.addEventListener(DISMISSED, listener)
  return () => window.removeEventListener(DISMISSED, listener)
}

export function removedLine({ gone, dismissed }: { gone: Cloud['gone']; dismissed: string[] }): { key: string; text: string } | null {
  const last = gone.filter((each) => each.why === 'removed' && !dismissed.includes(goneKey(each))).at(-1)
  if (!last) return null
  return { key: goneKey(last), text: last.owner ? `Removed from ${last.name} by ${nameOf(last.owner)}` : `Removed from ${last.name}` }
}
