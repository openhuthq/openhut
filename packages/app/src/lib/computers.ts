import { BrowserIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'

export type Features = { whatsapp: boolean; browser: boolean; cloud?: boolean }
export type Computer = { id: string; name: string; kind: 'here' | 'desktop' | 'server'; url: string; online: boolean; features: Features; appTooOld: boolean; runtimeTooOld: boolean; server?: boolean }

// The id a computer has in the App (its tunnel key) from its device key.
export function tunnelKeyOf(deviceKey: string): string {
  return Array.from(atob(deviceKey.replaceAll('-', '+').replaceAll('_', '/')).slice(32), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

const ANYWHERE: Features = { whatsapp: true, browser: true }
const UNKNOWN: Features = { whatsapp: false, browser: false }

// A browser (or the phone app) joins with os 'web' and a name like "Chrome (web)". The os isn't kept after a restart, the signed name is.
export function isBrowser(device: { name: string | null; os?: string | null }): boolean {
  return device.os === 'web' || / \(web\)$/.test(device.name ?? '')
}

// `shell`: the app runs in the desktop shell on the computer it talks to, so `here` keeps its platform name. Otherwise it's named after its own device record.
export function computersOf({ here, devices, shell = true }: { here: Computer; devices: Cloud['devices']; shell?: boolean }): Computer[] {
  const self = shell ? undefined : devices.find((device) => device.here)
  const first = self ? { ...here, name: self.name ?? here.name, server: self.kind === 'server' } : here
  return [first, ...devices.filter((device) => !device.here && !isBrowser(device)).map((device): Computer => {
    const server = device.kind === 'server'
    return { id: device.key, name: device.name ?? (server ? 'Server' : 'Your other computer'), kind: server ? 'server' : 'desktop', url: '', online: device.online, features: server ? ANYWHERE : UNKNOWN, appTooOld: false, runtimeTooOld: false }
  })]
}

export const DEVICE_ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon, browser: BrowserIcon }
export const DEVICE_HUE = 'text-hue-blue'

export function deviceIcon({ kind, server }: { kind: string; server?: boolean }) {
  if (server || kind === 'server') return DEVICE_ICONS.server
  return kind === 'browser' || kind === 'iphone' ? DEVICE_ICONS[kind] : DEVICE_ICONS.mac
}
