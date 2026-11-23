import type { Cloud } from '@openhut/common/cloud/cloud.ts'

export type Features = { whatsapp: boolean; browser: boolean }
export type Computer = { id: string; name: string; kind: 'here' | 'desktop' | 'server'; url: string; online: boolean; features: Features; appTooOld: boolean; runtimeTooOld: boolean }

const ANYWHERE: Features = { whatsapp: true, browser: true }
const UNKNOWN: Features = { whatsapp: false, browser: false }

export function computersOf({ here, devices }: { here: Computer; devices: Cloud['devices'] }): Computer[] {
  return [here, ...devices.filter((device) => !device.here).map((device): Computer => {
    const server = device.kind === 'server'
    return { id: device.key, name: device.name ?? (server ? 'Server' : 'Your other computer'), kind: server ? 'server' : 'desktop', url: '', online: device.online, features: server ? ANYWHERE : UNKNOWN, appTooOld: false, runtimeTooOld: false }
  })]
}
