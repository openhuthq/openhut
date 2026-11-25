import { BrowserIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'

export type Features = { whatsapp: boolean; browser: boolean; cloud?: boolean }
export type Computer = { id: string; name: string; kind: 'here' | 'server'; url: string; online: boolean; features: Features; runtimeTooOld: boolean; server?: boolean }

// The id a computer has in the App (its tunnel key) from its device key.
export function tunnelKeyOf(deviceKey: string): string {
  return Array.from(atob(deviceKey.replaceAll('-', '+').replaceAll('_', '/')).slice(32), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

const ANYWHERE: Features = { whatsapp: true, browser: true }

// A browser joins with os 'web' and a name like "Chrome (web)". The os isn't kept after a restart, the signed name is.
export function isBrowser(device: { name: string | null; os?: string | null }): boolean {
  return device.os === 'web' || / \(web\)$/.test(device.name ?? '')
}

// The computer the App talks to is named after its own device record.
export function computersOf({ here, devices }: { here: Computer; devices: Cloud['devices'] }): Computer[] {
  const self = devices.find((device) => device.here)
  const first = self ? { ...here, name: self.name ?? here.name, server: self.kind === 'server' } : here
  return [first, ...devices.filter((device) => !device.here && device.kind === 'server' && !isBrowser(device))
    .map((device): Computer => ({ id: device.key, name: device.name ?? 'Server', kind: 'server', url: '', online: device.online, features: ANYWHERE, runtimeTooOld: false }))]
}

export const DEVICE_ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon, browser: BrowserIcon }
export const DEVICE_HUE = 'text-hue-blue'

export function deviceIcon({ kind, server }: { kind: string; server?: boolean }) {
  if (server || kind === 'server') return DEVICE_ICONS.server
  return kind === 'browser' || kind === 'iphone' ? DEVICE_ICONS[kind] : DEVICE_ICONS.mac
}
